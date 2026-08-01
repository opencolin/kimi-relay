import { useEffect, useRef } from "react";

/**
 * The RobotExpressive mascot from the three.js skinning/morph example
 * (model by Tomás Laulhé, CC0; adapted from mrdoob/three.js
 * examples/webgl_animation_skinning_morph.html). Renders on a transparent
 * canvas, idles, and plays a random emote every few seconds. Client-only:
 * three.js is dynamically imported so it lands in its own chunk, and nothing
 * mounts for users who prefer reduced motion.
 */
export function HeroRobot({ className }: Readonly<{ className?: string }>) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let disposed = false;
    let raf = 0;
    let emoteTimer = 0;
    let cleanup: (() => void) | undefined;

    Promise.all([import("three"), import("three/addons/loaders/GLTFLoader.js")]).then(
      ([THREE, { GLTFLoader }]) => {
        if (disposed || !containerRef.current) return;

        const width = container.clientWidth;
        const height = container.clientHeight;

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        renderer.setClearColor(0x000000, 0);
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();

        const camera = new THREE.PerspectiveCamera(40, width / height, 0.25, 100);
        camera.position.set(-4.2, 2.2, 9.5);
        camera.lookAt(0, 1.5, 0);

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3a4a7a, 3);
        hemiLight.position.set(0, 20, 0);
        scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 3);
        dirLight.position.set(0, 20, 10);
        scene.add(dirLight);

        const clock = new THREE.Clock();
        let mixer: import("three").AnimationMixer | undefined;
        const actions: Record<string, import("three").AnimationAction> = {};
        let activeAction: import("three").AnimationAction | undefined;

        const oneShotEmotes = ["Wave", "Yes", "Jump", "ThumbsUp", "Punch"];

        const fadeToAction = (name: string, duration: number) => {
          const next = actions[name];
          if (!next || next === activeAction) return;
          const previous = activeAction;
          activeAction = next;
          previous?.fadeOut(duration);
          next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(duration).play();
        };

        new GLTFLoader().load("/models/RobotExpressive.glb", (gltf) => {
          if (disposed) return;
          scene.add(gltf.scene);
          mixer = new THREE.AnimationMixer(gltf.scene);
          for (const clip of gltf.animations) {
            const action = mixer.clipAction(clip);
            actions[clip.name] = action;
            if (oneShotEmotes.includes(clip.name)) {
              action.clampWhenFinished = true;
              action.loop = THREE.LoopOnce;
            }
          }
          fadeToAction("Idle", 0);
          mixer.addEventListener("finished", () => fadeToAction("Idle", 0.35));
          emoteTimer = window.setInterval(() => {
            const emote = oneShotEmotes[Math.floor(Math.random() * oneShotEmotes.length)];
            fadeToAction(emote, 0.3);
          }, 6000);
        });

        const onResize = () => {
          const w = container.clientWidth;
          const h = container.clientHeight;
          if (!w || !h) return;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        };
        const resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(container);

        const animate = () => {
          raf = window.requestAnimationFrame(animate);
          mixer?.update(clock.getDelta());
          renderer.render(scene, camera);
        };
        animate();

        cleanup = () => {
          resizeObserver.disconnect();
          renderer.dispose();
          renderer.domElement.remove();
        };
      },
    );

    return () => {
      disposed = true;
      window.cancelAnimationFrame(raf);
      window.clearInterval(emoteTimer);
      cleanup?.();
    };
  }, []);

  return <div ref={containerRef} aria-hidden="true" className={className} />;
}
