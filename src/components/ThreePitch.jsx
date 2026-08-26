// components/ThreePitch.jsx

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export default function ThreePitch({ 
  homeXI = [], 
  awayXI = [], 
  homeColor = '#3b82f6', 
  awayColor = '#ef4444',
  formation = '4-4-2',
}) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const homePlayersRef = useRef([]);
  const awayPlayersRef = useRef([]);
  const ballRef = useRef(null);

  // Formation positions
  const getFormationPositions = useCallback((formationName) => {
    const formations = {
      '4-4-2': [
        { x: 8, y: 50 }, { x: 23, y: 18 }, { x: 23, y: 39 }, { x: 23, y: 61 }, { x: 23, y: 82 },
        { x: 42, y: 20 }, { x: 42, y: 42 }, { x: 42, y: 58 }, { x: 42, y: 80 },
        { x: 62, y: 36 }, { x: 62, y: 64 },
      ],
      '4-3-3': [
        { x: 8, y: 50 }, { x: 23, y: 18 }, { x: 23, y: 39 }, { x: 23, y: 61 }, { x: 23, y: 82 },
        { x: 42, y: 30 }, { x: 42, y: 50 }, { x: 42, y: 70 },
        { x: 64, y: 20 }, { x: 64, y: 50 }, { x: 64, y: 80 },
      ],
      '3-5-2': [
        { x: 8, y: 50 }, { x: 23, y: 30 }, { x: 23, y: 50 }, { x: 23, y: 70 },
        { x: 42, y: 20 }, { x: 42, y: 39 }, { x: 42, y: 50 }, { x: 42, y: 61 }, { x: 42, y: 80 },
        { x: 64, y: 36 }, { x: 64, y: 64 },
      ],
    };
    return formations[formationName] || formations['4-4-2'];
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth || 800;
    const height = mountRef.current.clientHeight || 500;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 22, 28);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2.5;
    controls.minDistance = 15;
    controls.maxDistance = 45;
    controls.update();
    controlsRef.current = controls;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Pitch
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 20),
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 })
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    scene.add(pitch);

    // Lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });

    // Border
    const border = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-15, 0.01, -10), new THREE.Vector3(15, 0.01, -10),
      new THREE.Vector3(15, 0.01, 10), new THREE.Vector3(-15, 0.01, 10),
      new THREE.Vector3(-15, 0.01, -10),
    ]);
    scene.add(new THREE.Line(border, lineMat));

    // Center line
    const center = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.01, -10), new THREE.Vector3(0, 0.01, 10),
    ]);
    scene.add(new THREE.Line(center, lineMat));

    // Center circle
    const circle = new THREE.Mesh(
      new THREE.RingGeometry(3, 3.05, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.02;
    scene.add(circle);

    // Goals
    const goalMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const leftGoal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 6), goalMat);
    leftGoal.position.set(-15, 0.08, 0);
    scene.add(leftGoal);

    const rightGoal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 6), goalMat);
    rightGoal.position.set(15, 0.08, 0);
    scene.add(rightGoal);

    // Ball
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
    );
    ball.position.set(0, 0.15, 0);
    ball.castShadow = true;
    scene.add(ball);
    ballRef.current = ball;

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize
    const handleResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth || 800;
      const h = mountRef.current.clientHeight || 500;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      scene.clear();
    };
  }, []);

  // Create players
  useEffect(() => {
    if (!sceneRef.current) return;

    const positions = getFormationPositions(formation);
    const scene = sceneRef.current;

    // Remove old players
    homePlayersRef.current.forEach(p => scene.remove(p));
    awayPlayersRef.current.forEach(p => scene.remove(p));
    homePlayersRef.current = [];
    awayPlayersRef.current = [];

    const createPlayer = (x, z, color) => {
      const group = new THREE.Group();

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.35, 0.6, 16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
      );
      body.position.y = 0.3;
      group.add(body);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xffcc99 })
      );
      head.position.y = 0.75;
      group.add(head);

      group.position.set(x, 0, z);
      group.castShadow = true;
      return group;
    };

    // Home players (left side, attacking right)
    positions.forEach(pos => {
      const x = ((pos.x - 50) / 50) * 15;
      const z = ((pos.y - 50) / 50) * 10;
      const player = createPlayer(x, z, new THREE.Color(homeColor));
      scene.add(player);
      homePlayersRef.current.push(player);
    });

    // Away players (right side, attacking left)
    positions.forEach(pos => {
      const x = ((50 - pos.x) / 50) * 15;
      const z = ((50 - pos.y) / 50) * 10;
      const player = createPlayer(x, z, new THREE.Color(awayColor));
      scene.add(player);
      awayPlayersRef.current.push(player);
    });

  }, [formation, homeColor, awayColor, getFormationPositions]);

  return <div ref={mountRef} className="three-pitch" style={{ width: '100%', height: '500px' }} />;
}
