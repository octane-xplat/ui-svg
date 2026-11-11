// Vendored from @nativescript-community/ui-svg@0.2.24 (ISC) — SVGView only;
// CanvasSVG/ui-canvas dropped. Sources: index.ios.js upstream.
/// <reference path="./typings/ios.d.ts" />
/// <reference path="./typings/SVGKit.d.ts" />
import { CoreTypes, File, ImageAsset, Utils, knownFolders, path, visibilityProperty } from '@nativescript/core'
import { SVGView as SVGViewBase, srcProperty, stretchProperty } from './index.common'
import { resolveSvgUse } from './svg-use'
import { resolveSvgCurrentColor } from './svg-current-color.ios'

function imageFromMarkup(markup: string): SVGKImage | null {
	// Expand <use> ourselves: SVGKit builds the referenced shape geometry but
	// never applies the use element's own paint/transform attributes.
	return SVGKImage.imageWithSource(SVGKSourceString.sourceFromContentsOfString(resolveSvgUse(markup)))
}

function imageFromFile(filePath: string): SVGKImage | null {
	// Keep SVGKit's file source so relative references resolve against the
	// file URL; switch to markup loading only when the document needs the
	// <use> expansion above.
	let markup: string | undefined
	try {
		markup = File.fromPath(filePath).readTextSync()
	} catch {
		markup = undefined
	}
	if (markup == null) {
		return SVGKImage.imageWithContentsOfFile(filePath)
	}
	const resolved = resolveSvgUse(markup)
	if (resolved === markup) {
		return SVGKImage.imageWithContentsOfFile(filePath)
	}
	return SVGKImage.imageWithSource(SVGKSourceString.sourceFromContentsOfString(resolved))
}

function getUIImageScaleType(scaleType: string): number | null {
	switch (scaleType) {
		case 'aspectFill':
			return 2 /* UIViewContentMode.ScaleAspectFill */
		case 'aspectFit':
			return 1 /* UIViewContentMode.ScaleAspectFit */
		case 'fill':
			return 0 /* UIViewContentMode.ScaleToFill */
		case 'none':
			return 9 /* UIViewContentMode.TopLeft */
		default:
			break
	}
	return null
}

function decodeSVGKImage(src: string | ImageAsset | File): SVGKImage | null {
	if (!src) {
		return null
	}

	let imagePath: any
	if (src instanceof File) {
		let markup: string | undefined
		try {
			markup = src.readTextSync()
		} catch {
			markup = undefined
		}
		const resolved = markup == null ? markup : resolveSvgUse(markup)
		if (resolved != null && resolved !== markup) {
			return SVGKImage.imageWithSource(SVGKSourceString.sourceFromContentsOfString(resolved))
		}
		return SVGKImage.alloc().initWithData(NSData.alloc().initWithContentsOfFile(src.path))
	} else if (src instanceof ImageAsset) {
		imagePath = src.ios
	} else {
		imagePath = src
	}

	if (Utils.isFileOrResourcePath(imagePath)) {
		if (imagePath.indexOf(Utils.RESOURCE_PREFIX) === 0) {
			const resName = imagePath.slice(Utils.RESOURCE_PREFIX.length)
			return SVGKImage.imageNamed(resName)
		} else if (imagePath.indexOf('~/') === 0) {
			const strPath = path.join(knownFolders.currentApp().path, imagePath.replace('~/', ''))
			return imageFromFile(strPath)
		} else if (imagePath.indexOf('/') === 0) {
			return imageFromFile(imagePath)
		}
	}

	return imageFromMarkup(imagePath)
}

export function getSVGKImage(src: string | ImageAsset | File): SVGKImage | null {
	return resolveSvgCurrentColor(decodeSVGKImage(src))
}

export class SVGView extends SVGViewBase {
	aspectRatio = 0
	_imageSourceAffectsLayout = false

	createNativeView() {
		const view = SVGKFastImageView.alloc().initWithFrame(CGRectZero)
		view.backgroundColor = UIColor.clearColor
		view.opaque = false
		return view
	}

	_setNativeClipToBounds(): void {
		// Always set clipsToBounds for images
		this.nativeViewProtected.clipsToBounds = true
	}

	// UIKit drops the pending display of a view that sits inside a hidden or
	// collapsed ancestor at the moment it would draw, and unhiding the ancestor
	// does not re-run drawRect: — the layer stays without backing contents.
	// Re-request display once the view has positive bounds and no contents.
	private requestDisplayIfUndrawn(): void {
		const view = this.nativeViewProtected as SVGKFastImageView | undefined
		const size = view?.bounds?.size
		if (!size || size.width <= 0 || size.height <= 0 || view.hidden) {
			return
		}
		if (view.layer.contents == null) {
			view.setNeedsDisplay()
		}
	}

	onLayout(left: number, top: number, right: number, bottom: number): void {
		super.onLayout(left, top, right, bottom)
		this.requestDisplayIfUndrawn()
	}

	[visibilityProperty.setNative](value: CoreTypes.VisibilityType) {
		super[visibilityProperty.setNative](value)
		if (value === CoreTypes.Visibility.visible) {
			this.requestDisplayIfUndrawn()
		}
	}

	onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
		const svgImage = (this.nativeViewProtected as SVGKFastImageView).image
		if (!svgImage) {
			super.onMeasure(widthMeasureSpec, heightMeasureSpec)
			return
		}

		const width = Utils.layout.getMeasureSpecSize(widthMeasureSpec)
		const widthMode = Utils.layout.getMeasureSpecMode(widthMeasureSpec)
		const height = Utils.layout.getMeasureSpecSize(heightMeasureSpec)
		const heightMode = Utils.layout.getMeasureSpecMode(heightMeasureSpec)

		const imageSize = svgImage.size
		const finiteWidth = widthMode === Utils.layout.EXACTLY
		const finiteHeight = heightMode === Utils.layout.EXACTLY
		this._imageSourceAffectsLayout = !finiteWidth || !finiteHeight
		if (imageSize || this.aspectRatio > 0) {
			const nativeWidth = imageSize ? Utils.layout.toDevicePixels(imageSize.width) : 0
			const nativeHeight = imageSize ? Utils.layout.toDevicePixels(imageSize.height) : 0
			const imgRatio = nativeWidth / nativeHeight
			const ratio = this.aspectRatio || imgRatio
			if (finiteWidth || finiteHeight) {
				if (!finiteWidth) {
					widthMeasureSpec = Utils.layout.makeMeasureSpec(height * ratio, Utils.layout.EXACTLY)
				}
				if (!finiteHeight) {
					heightMeasureSpec = Utils.layout.makeMeasureSpec(width / ratio, Utils.layout.EXACTLY)
				}
			} else {
				const viewRatio = width / (height || 1000000000000)
				if (imgRatio > viewRatio) {
					const w = Math.min(nativeWidth, width)
					widthMeasureSpec = Utils.layout.makeMeasureSpec(w, Utils.layout.EXACTLY)
					heightMeasureSpec = Utils.layout.makeMeasureSpec(w / ratio, Utils.layout.EXACTLY)
				} else {
					const h = Math.min(nativeHeight, height)
					heightMeasureSpec = Utils.layout.makeMeasureSpec(h, Utils.layout.EXACTLY)
					widthMeasureSpec = Utils.layout.makeMeasureSpec(h * ratio, Utils.layout.EXACTLY)
				}
			}
		}
		super.onMeasure(widthMeasureSpec, heightMeasureSpec)
	}

	async handleSrc(src: any): Promise<void> {
		if (src instanceof Promise) {
			try {
				this.handleSrc(await src)
			} catch (error) {
				this.handleSrc(null)
			}
			return
		} else if (typeof src === 'function') {
			let newSrc = src()
			if (newSrc instanceof Promise) {
				try {
					await newSrc
				} catch (error) {
					newSrc = null
				}
			}
			this.handleSrc(newSrc)
			return
		}
		;(this.nativeViewProtected as SVGKFastImageView).image = getSVGKImage(src) as SVGKImage
		if (this._imageSourceAffectsLayout) {
			this._imageSourceAffectsLayout = false
			this.requestLayout()
		}
	}

	[srcProperty.setNative](value: any) {
		this.handleSrc(value)
	}

	[stretchProperty.setNative](value: 'none' | 'aspectFill' | 'aspectFit' | 'fill') {
		this.nativeViewProtected.contentMode = getUIImageScaleType(value) as UIViewContentMode
	}
}
