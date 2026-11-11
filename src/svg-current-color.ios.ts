/// <reference path="./typings/SVGKit.d.ts" />

/** SVGKit 3.x sends currentColor to its named-color parser (which returns
 * black). Resolve paint on the parsed tree before its lazy CALayer creation.
 * Use SVGKit's local cascade, including stylesheets, then inherit through the
 * actual element tree. Never rewrite XML, URLs, text, or literal paints. */
export function resolveSvgCurrentColor(image: SVGKImage | null): SVGKImage | null {
	if (!image?.DOMTree) return image
	const updates: { element: SVGElement; declarations: string[] }[] = []

	function inherited(value: string | null, parent: string, initial: string): string {
		const keyword = value?.trim().toLowerCase()
		if (!keyword || keyword === 'inherit' || keyword === 'unset') return parent
		if (keyword === 'initial') return initial
		return value!.trim()
	}

	function visit(node: Node, parentColor: string, parentFill: string, parentStroke: string): void {
		let color = parentColor
		let fill = parentFill
		let stroke = parentStroke
		if (node instanceof SVGElement) {
			const local = (property: string) => node.cascadedValueForStylablePropertyInherit(property, false)
			color = inherited(local('color'), parentColor, 'black')
			// currentColor on color itself means the inherited color.
			if (color.toLowerCase() === 'currentcolor') color = parentColor
			fill = inherited(local('fill'), parentFill, 'black')
			stroke = inherited(local('stroke'), parentStroke, 'none')
			const declarations: string[] = []
			for (const [property, value] of [['fill', fill], ['stroke', stroke]]) {
				if (value.toLowerCase() === 'currentcolor') declarations.push(`${property}:${color}`)
			}
			if (declarations.length) updates.push({ element: node, declarations })
		}
		for (let i = 0; i < node.childNodes.length; i++) {
			visit(node.childNodes.item(i), color, fill, stroke)
		}
	}

	visit(image.DOMTree, 'black', 'black', 'none')
	// Snapshot first: resolving a parent's fill must not freeze currentColor
	// inherited by a child that declares a different color.
	for (const { element, declarations } of updates) {
		const style = element.style ?? CSSStyleDeclaration.new()
		// SVGKit's setProperty method asserts unconditionally; cssText is its
		// supported mutation API. Preserve all pre-existing inline declarations.
		style.cssText = `${style.cssText ?? ''};${declarations.join(';')}`
		element.style = style
	}
	return image
}
