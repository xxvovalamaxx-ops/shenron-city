/**
 * In-world text rendered from a browser canvas.
 *
 * Drei's default Text path resolves glyph fonts from a third-party CDN. This
 * component uses only the browser's built-in generic sans-serif font, creating
 * a local canvas texture with no runtime network request.
 */
import { useEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'

type Vec3 = [number, number, number]
type HorizontalAnchor = 'left' | 'center' | 'right'
type VerticalAnchor = 'top' | 'middle' | 'bottom'

interface WorldTextProps {
  children: ReactNode
  position?: Vec3
  rotation?: Vec3
  fontSize?: number
  color?: string
  anchorX?: HorizontalAnchor
  anchorY?: VerticalAnchor
  /** Accepted for compatibility with the previous text component. */
  outlineWidth?: number
}

function textValue(children: ReactNode): string {
  if (Array.isArray(children)) return children.map(textValue).join('')
  if (children === null || children === undefined || typeof children === 'boolean') return ''
  return String(children)
}

export function WorldText({
  children,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  fontSize = 0.2,
  color = '#ffffff',
  anchorX = 'center',
  anchorY = 'middle',
}: WorldTextProps) {
  const text = textValue(children)

  const surface = useMemo(() => {
    const fontPixels = 96
    const padding = 24
    const canvas = document.createElement('canvas')
    const measure = canvas.getContext('2d')
    if (!measure) throw new Error('Canvas 2D context is unavailable')

    measure.font = `600 ${fontPixels}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    const measuredWidth = Math.max(fontPixels / 2, measure.measureText(text).width)
    canvas.width = Math.ceil(measuredWidth + padding * 2)
    canvas.height = fontPixels + padding * 2

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.font = `600 ${fontPixels}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    context.fillStyle = color
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false

    const height = fontSize
    const width = Math.max(fontSize * 0.5, fontSize * (canvas.width / canvas.height))
    return { texture, width, height }
  }, [color, fontSize, text])

  useEffect(() => () => surface.texture.dispose(), [surface])

  const offsetX =
    anchorX === 'left' ? surface.width / 2 : anchorX === 'right' ? -surface.width / 2 : 0
  const offsetY =
    anchorY === 'top' ? -surface.height / 2 : anchorY === 'bottom' ? surface.height / 2 : 0

  return (
    <group position={position} rotation={rotation}>
      <mesh position={[offsetX, offsetY, 0]}>
        <planeGeometry args={[surface.width, surface.height]} />
        <meshBasicMaterial
          map={surface.texture}
          transparent
          alphaTest={0.04}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}
