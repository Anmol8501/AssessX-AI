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

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    let animationFrameId: number
    const clock = new THREE.Clock()

    // 1. Scene
    const scene = new THREE.Scene()

    // 2. Camera
    const width = container.clientWidth || 96
    const height = container.clientHeight || 96
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    camera.position.set(0, 0.2, 4.2)

    // 3. Renderer with transparent background
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    container.appendChild(renderer.domElement)

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8)
    scene.add(ambientLight)

    const mainLight = new THREE.DirectionalLight(0xffffff, 2.2)
    mainLight.position.set(3, 4, 3)
    scene.add(mainLight)

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.4)
    fillLight.position.set(-3, 2, -2)
    scene.add(fillLight)

    const rimLight = new THREE.PointLight(0x06b6d4, 2.0, 10)
    rimLight.position.set(0, -1, 2)
    scene.add(rimLight)

    // 5. Load GLB Model
    let robotModel: THREE.Group | null = null
    const loader = new GLTFLoader()

    loader.load(
      '/cute_robot_3d_model.glb',
      (gltf) => {
        robotModel = gltf.scene

        // Center and normalize scale
        const box = new THREE.Box3().setFromObject(robotModel)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())

        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = 2.4 / (maxDim || 1)
        robotModel.scale.setScalar(scale)

        robotModel.position.x = -center.x * scale
        robotModel.position.y = -center.y * scale
        robotModel.position.z = -center.z * scale

        // Pivot wrapper for smooth rotation and floating
        const pivot = new THREE.Group()
        pivot.add(robotModel)
        scene.add(pivot)
        robotModel = pivot

        setLoaded(true)
      },
      undefined,
      (error) => {
        console.error('Failed to load 3D robot model:', error)
      },
    )

    // 6. Animation loop
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)

      const elapsed = clock.getElapsedTime()
      if (robotModel) {
        // Floating bobbing motion on Y-axis
        robotModel.position.y = Math.sin(elapsed * 2.2) * 0.12

        // Rotation speed increases on hover
        const rotSpeed = isHoveredRef.current ? 1.8 : 0.7
        robotModel.rotation.y += 0.015 * rotSpeed

        // Slight breathing tilt on Z/X
        robotModel.rotation.z = Math.sin(elapsed * 1.5) * 0.05
      }

      renderer.render(scene, camera)
    }

    animate()

    // 7. Resize handling
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

    // 8. Hover listeners
    const onEnter = () => {
      if (interactive) isHoveredRef.current = true
    }
    const onLeave = () => {
      if (interactive) isHoveredRef.current = false
    }

    container.addEventListener('mouseenter', onEnter)
    container.addEventListener('mouseleave', onLeave)

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      container.removeEventListener('mouseenter', onEnter)
      container.removeEventListener('mouseleave', onLeave)
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      renderer.dispose()
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

