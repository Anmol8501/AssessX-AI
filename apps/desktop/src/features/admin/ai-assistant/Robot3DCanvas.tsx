import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

interface Robot3DCanvasProps {
  className?: string
  interactive?: boolean
}

export function Robot3DCanvas({ className, interactive = true }: Robot3DCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const isHoveredRef = useRef(false)
  const mouseRef = useRef({ x: 0, y: 0 })
  const clickBoostRef = useRef(0)

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    let animationFrameId: number
    const clock = new THREE.Clock()

    // 1. Scene
    const scene = new THREE.Scene()

    // 2. Camera with generous view distance for 1.5x jumps
    const width = container.clientWidth || 96
    const height = container.clientHeight || 96
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    camera.position.set(0, 0.1, 4.6)

    // 3. Renderer with transparent background
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.25
    container.appendChild(renderer.domElement)

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8)
    scene.add(ambientLight)

    const mainLight = new THREE.DirectionalLight(0xffffff, 2.2)
    mainLight.position.set(3, 4, 3)
    scene.add(mainLight)

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.5)
    fillLight.position.set(-3, 2, -2)
    scene.add(fillLight)

    const rimLight = new THREE.PointLight(0x06b6d4, 2.2, 10)
    rimLight.position.set(0, -1, 2)
    scene.add(rimLight)

    // 5. Dynamic Ground Shadow Plane
    const shadowGeo = new THREE.PlaneGeometry(1.2, 0.6)
    shadowGeo.rotateX(-Math.PI / 2)
    const shadowCanvas = document.createElement('canvas')
    shadowCanvas.width = 128
    shadowCanvas.height = 128
    const ctx = shadowCanvas.getContext('2d')
    if (ctx) {
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 60)
      gradient.addColorStop(0, 'rgba(6, 182, 212, 0.45)')
      gradient.addColorStop(0.5, 'rgba(14, 165, 233, 0.25)')
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 128, 128)
    }
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas)
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    })
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat)
    const BASE_Y = -0.72
    shadowMesh.position.set(0, BASE_Y, 0)
    scene.add(shadowMesh)

    // 6. Load GLB Model (Parrot Bot)
    let pivot: THREE.Group | null = null
    const loader = new GLTFLoader()

    const setupModel = (gltf: any) => {
      const model = gltf.scene

      // Compute bounds to place feet precisely at pivot origin (0, 0, 0)
      const box = new THREE.Box3().setFromObject(model)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())

      const maxDim = Math.max(size.x, size.y, size.z)
      const scale = 1.7 / (maxDim || 1)
      model.scale.setScalar(scale)

      // Center X & Z, and place feet (min.y) at Y = 0
      model.position.x = -center.x * scale
      model.position.y = -box.min.y * scale
      model.position.z = -center.z * scale

      // Create pivot group positioned at ground level
      pivot = new THREE.Group()
      pivot.position.set(0, BASE_Y, 0)
      pivot.add(model)
      scene.add(pivot)

      setLoaded(true)
    }

    loader.load(
      '/parrot_bot.glb',
      setupModel,
      undefined,
      (error) => {
        console.warn('Failed to load /parrot_bot.glb, trying fallback:', error)
        loader.load(
          '/cute_robot_3d_model.glb',
          setupModel,
          undefined,
          (fallbackErr) => {
            console.error('Failed to load 3D robot model:', fallbackErr)
          },
        )
      },
    )

    // 7. Animation loop with Jumping + Squash & Stretch + Interactivity
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)

      const elapsed = clock.getElapsedTime()
      if (pivot) {
        // Base jump frequency: faster when hovered, with click bounce boost
        const speed = isHoveredRef.current ? 3.4 : 2.7
        const cycle = (elapsed * speed) % (Math.PI * 2)

        // Click boost decay
        clickBoostRef.current *= 0.92
        const boost = clickBoostRef.current

        let jumpHeight = 0
        let scaleY = 1.0
        let scaleXZ = 1.0

        if (cycle < Math.PI) {
          // --- AIRBORNE JUMP PHASE (0 -> PI) ---
          const t = cycle / Math.PI // 0 at takeoff, 0.5 at apex, 1.0 at touchdown
          const arc = Math.sin(t * Math.PI) // 0 -> 1 -> 0

          // Jump upward
          jumpHeight = arc * (0.65 + 0.35 * boost)

          // Scale smoothly expands to ~1.5x at apex
          const overallScale = 1.0 + (0.5 + 0.25 * boost) * arc

          // Velocity-based stretch along Y
          const velocity = Math.cos(t * Math.PI)
          const stretch = 1.0 + 0.16 * velocity
          scaleY = overallScale * stretch
          scaleXZ = overallScale / Math.sqrt(Math.max(0.4, stretch))
        } else {
          // --- GROUND TOUCHDOWN & SQUASH / ANTICIPATION PHASE (PI -> 2*PI) ---
          const t = (cycle - Math.PI) / Math.PI // 0 to 1
          jumpHeight = 0

          if (t < 0.38) {
            // Impact squash: compresses vertically, bulges horizontally
            const squashArc = Math.sin((t / 0.38) * Math.PI)
            scaleY = 1.0 - 0.28 * squashArc
            scaleXZ = 1.0 + 0.22 * squashArc
          } else {
            // Recoil anticipation: slight pre-jump crouch
            const prepArc = Math.sin(((t - 0.38) / 0.62) * Math.PI)
            scaleY = 1.0 - 0.08 * prepArc
            scaleXZ = 1.0 + 0.06 * prepArc
          }
        }

        // Apply jump position and squash & stretch scale
        pivot.position.y = BASE_Y + jumpHeight
        pivot.scale.set(scaleXZ, scaleY, scaleXZ)

        // Ground shadow response: shrinks and fades as bot goes airborne
        const shadowScale = Math.max(0.35, 1.0 - jumpHeight * 0.7) * (scaleXZ / 1.0)
        shadowMesh.scale.set(shadowScale, shadowScale, shadowScale)
        shadowMat.opacity = Math.max(0.12, 0.45 - jumpHeight * 0.35)

        // Interactive look-at mouse tracking (NO continuous 360 spin)
        const targetRotY = isHoveredRef.current ? mouseRef.current.x * 0.45 : 0
        const targetRotX = isHoveredRef.current ? -mouseRef.current.y * 0.28 : 0

        // Gentle side-to-side playful wobble synchronized with jump
        const wobbleZ = Math.sin(cycle) * 0.07

        pivot.rotation.y = THREE.MathUtils.lerp(pivot.rotation.y, targetRotY, 0.1)
        pivot.rotation.x = THREE.MathUtils.lerp(pivot.rotation.x, targetRotX, 0.1)
        pivot.rotation.z = THREE.MathUtils.lerp(pivot.rotation.z, wobbleZ, 0.1)
      }

      renderer.render(scene, camera)
    }

    animate()

    // 8. Resize handling
    const handleResize = () => {
      if (!container) return
      const w = container.clientWidth
      const h = container.clientHeight
      if (w && h) {
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
    }

    window.addEventListener('resize', handleResize)

    // 9. Interactive listeners: hover, cursor tracking, and click boost
    const onEnter = () => {
      if (interactive) isHoveredRef.current = true
    }
    const onLeave = () => {
      if (interactive) {
        isHoveredRef.current = false
        mouseRef.current = { x: 0, y: 0 }
      }
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!interactive) return
      const rect = container.getBoundingClientRect()
      if (rect.width && rect.height) {
        mouseRef.current = {
          x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
          y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
        }
      }
    }
    const onClick = () => {
      if (interactive) {
        clickBoostRef.current = 1.0
      }
    }

    container.addEventListener('mouseenter', onEnter)
    container.addEventListener('mouseleave', onLeave)
    container.addEventListener('mousemove', onMouseMove)
    container.addEventListener('click', onClick)

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      container.removeEventListener('mouseenter', onEnter)
      container.removeEventListener('mouseleave', onLeave)
      container.removeEventListener('mousemove', onMouseMove)
      container.removeEventListener('click', onClick)
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      renderer.dispose()
      shadowTexture.dispose()
      shadowGeo.dispose()
      shadowMat.dispose()
    }
  }, [interactive])

  return (
    <div ref={mountRef} className={`relative flex items-center justify-center ${className ?? ''}`}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      )}
    </div>
  )
}
