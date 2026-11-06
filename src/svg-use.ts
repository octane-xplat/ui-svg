// Vendored xplat addition (no upstream equivalent): SVGKit 3.x resolves <use>
// references into an element-instance tree at parse time, but
// SVGUseElement.layoutLayer: only forwards to the linked element — the use
// element's own fill/stroke/style/transform/x/y never reach the generated
// CAShapeLayer, so use-based icons parse, size, and produce shape geometry
// yet paint nothing. Expanding each <use> before SVGKit sees the markup
// restores the paint: the use becomes a <g> carrying its non-reserved
// attributes plus an x/y translate wrapping a clone of the referenced
// element (the SVG 1.1 §5.6 generated-content model). <symbol>/<svg>
// references generate an <svg> clone instead.
import { ParserEventType, XmlParser } from '@nativescript/core'

interface SvgElement {
	name: string
	attrs: [string, string][]
	children: SvgChild[]
}

type SvgChild = SvgElement | { text: string } | { comment: string } | { cdata: string }

// x/y become an appended translate; width/height only size generated
// <svg>/<symbol> clones; href attributes select the reference target.
const RESERVED_USE_ATTRS = new Set(['x', 'y', 'width', 'height', 'xlink:href', 'href'])

const USE_ELEMENT = /<use[\s/>]/

function isElement(child: SvgChild): child is SvgElement {
	return 'children' in child
}

function localName(name: string): string {
	const colon = name.indexOf(':')
	return colon === -1 ? name : name.slice(colon + 1)
}

function attributeOf(element: SvgElement, name: string): string | undefined {
	for (const [key, value] of element.attrs) {
		if (key === name) {
			return value
		}
	}
	return undefined
}

function setAttribute(element: SvgElement, name: string, value: string): void {
	for (const pair of element.attrs) {
		if (pair[0] === name) {
			pair[1] = value
			return
		}
	}
	element.attrs.push([name, value])
}

function cloneElement(element: SvgElement): SvgElement {
	return {
		name: element.name,
		attrs: element.attrs.map(([key, value]) => [key, value]),
		children: element.children.map(cloneChild),
	}
}

function cloneChild(child: SvgChild): SvgChild {
	return isElement(child) ? cloneElement(child) : { ...child }
}

function parseMarkup(markup: string): SvgChild[] | null {
	const document: SvgElement = { name: '#document', attrs: [], children: [] }
	const stack: SvgElement[] = [document]
	let failed = false
	const parser = new XmlParser(
		(event) => {
			const parent = stack[stack.length - 1]
			switch (event.eventType) {
				case ParserEventType.StartElement: {
					const element: SvgElement = { name: event.elementName, attrs: [], children: [] }
					const attributes = event.attributes
					if (attributes != null && typeof attributes === 'object') {
						for (const [key, value] of Object.entries(attributes)) {
							element.attrs.push([key, value == null ? '' : String(value)])
						}
					}
					parent.children.push(element)
					stack.push(element)
					break
				}
				case ParserEventType.EndElement:
					// easysax fires EndElement for self-closing tags too; an
					// unmatched close means the input was not well-formed.
					if (stack.length > 1) {
						stack.pop()
					} else {
						failed = true
					}
					break
				case ParserEventType.Text:
					parent.children.push({ text: event.data })
					break
				case ParserEventType.Comment:
					parent.children.push({ comment: event.data })
					break
				case ParserEventType.CDATA:
					parent.children.push({ cdata: event.data })
					break
				default:
					break
			}
		},
		() => {
			failed = true
		},
	)
	try {
		parser.parse(markup)
	} catch {
		failed = true
	}
	return failed || stack.length !== 1 ? null : document.children
}

// A use's x/y is an extra translate appended after its transform (§5.6).
function applyUseTranslate(generated: SvgElement, use: SvgElement): void {
	const x = attributeOf(use, 'x')
	const y = attributeOf(use, 'y')
	if (x == null && y == null) {
		return
	}
	const translate = `translate(${x ?? '0'} ${y ?? '0'})`
	const base = attributeOf(generated, 'transform')
	setAttribute(generated, 'transform', base ? `${base} ${translate}` : translate)
}

function expandUse(use: SvgElement, byId: Map<string, SvgElement>, resolving: ReadonlySet<string>): SvgChild {
	// Non-reference children (animation, descriptive text) stay attached to
	// the generated content and may themselves contain uses.
	expandChildren(use.children, byId, resolving)

	const href = attributeOf(use, 'xlink:href') ?? attributeOf(use, 'href')
	if (href == null || !href.startsWith('#')) {
		return use
	}
	const id = href.slice(1)
	const target = byId.get(id)
	if (target == null || resolving.has(id)) {
		return use
	}
	const nested = new Set(resolving)
	nested.add(id)
	const instance = cloneElement(target)
	expandChildren(instance.children, byId, nested)

	if (localName(target.name) === 'svg' || localName(target.name) === 'symbol') {
		// A use on <svg>/<symbol> generates an <svg> viewport element sized by
		// the use's width/height (default 100%) rather than a <g> wrapper.
		instance.name = 'svg'
		setAttribute(instance, 'width', attributeOf(use, 'width') ?? '100%')
		setAttribute(instance, 'height', attributeOf(use, 'height') ?? '100%')
		for (const [key, value] of use.attrs) {
			if (!RESERVED_USE_ATTRS.has(key) && attributeOf(instance, key) == null) {
				instance.attrs.push([key, value])
			}
		}
		applyUseTranslate(instance, use)
		return instance
	}

	const generated: SvgElement = {
		name: 'g',
		attrs: use.attrs.filter(([key]) => !RESERVED_USE_ATTRS.has(key)),
		children: [instance, ...use.children],
	}
	applyUseTranslate(generated, use)
	return generated
}

function expandChildren(children: SvgChild[], byId: Map<string, SvgElement>, resolving: ReadonlySet<string>): void {
	for (let i = 0; i < children.length; i++) {
		const child = children[i]
		if (!isElement(child)) {
			continue
		}
		if (localName(child.name) === 'use') {
			// Generated content is already expanded inside expandUse — walking
			// it again would defeat cycle detection.
			children[i] = expandUse(child, byId, resolving)
		} else {
			expandChildren(child.children, byId, resolving)
		}
	}
}

function indexById(children: SvgChild[], byId: Map<string, SvgElement>): void {
	for (const child of children) {
		if (!isElement(child)) {
			continue
		}
		const id = attributeOf(child, 'id')
		if (id != null && !byId.has(id)) {
			byId.set(id, child)
		}
		indexById(child.children, byId)
	}
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function escapeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function serialize(children: SvgChild[], out: string[]): void {
	for (const child of children) {
		if ('text' in child) {
			out.push(escapeText(child.text))
		} else if ('comment' in child) {
			out.push(`<!--${child.comment}-->`)
		} else if ('cdata' in child) {
			out.push(`<![CDATA[${child.cdata}]]>`)
		} else {
			const attrs = child.attrs.map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('')
			if (child.children.length === 0) {
				out.push(`<${child.name}${attrs}/>`)
			} else {
				out.push(`<${child.name}${attrs}>`)
				serialize(child.children, out)
				out.push(`</${child.name}>`)
			}
		}
	}
}

/** Expand <use> references into generated <g>/<svg> clones per SVG 1.1 §5.6.
 *  Returns the input unchanged when the markup has no <use>, fails to parse,
 *  or no reference resolves — SVGKit then sees exactly what it saw before. */
export function resolveSvgUse(markup: string): string {
	if (!USE_ELEMENT.test(markup)) {
		return markup
	}
	const children = parseMarkup(markup)
	if (children == null) {
		return markup
	}
	const byId = new Map<string, SvgElement>()
	indexById(children, byId)
	expandChildren(children, byId, new Set())
	const out: string[] = []
	serialize(children, out)
	return out.join('')
}
