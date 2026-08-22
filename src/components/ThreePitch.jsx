// src/components/ThreePitch.jsx

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export default function ThreePitch({ 
  homeXI = [], 
  awayXI = [], 
  formation = '4-4-2',
  ballPossession = null,
}) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const ballRef = useRef(null);
  const homePlayersRef = useRef([]);
  const awayPlayersRef = useRef([]);

  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);
    scene.fog = new THREE.Fog(0x0b1120, 30, 80);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 25, 30);
    camera.lookAt(0, 0, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controls.maxPolarAngle = Math.PI / 2.5;
    controls.minDistance = 15;
    controls.maxDistance = 50;
    controls.update();

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Pitch
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 20),
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 })
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    scene.add(pitch);

    // Pitch lines
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });

    // Border
    const borderGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-15, 0.01, -10),
      new THREE.Vector3(15, 0.01, -10),
      new THREE.Vector3(15, 0.01, 10),
      new THREE.Vector3(-15, 0.01, 10),
      new THREE.Vector3(-15, 0.01, -10),
    ]);
    scene.add(new THREE.Line(borderGeometry, lineMaterial));

    // Center line
    const centerLine = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.01, -10),
      new THREE.Vector3(0, 0.01, 10),
    ]);
    scene.add(new THREE.Line(centerLine, lineMaterial));

    // Center circle
    const centerCircle = new THREE.Mesh(
      new THREE.RingGeometry(3, 3.05, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    centerCircle.rotation.x = -Math.PI / 2;
    centerCircle.position.y = 0.02;
    scene.add(centerCircle);

    // Goals
    const goalMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    
    const leftGoal = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.15, 6),
      goalMaterial
    );
    leftGoal.position.set(-15, 0.08, 0);
    scene.add(leftGoal);

    const rightGoal = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.15, 6),
      goalMaterial
    );
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

    // Store refs
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    const handleResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
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

  // Update players when formation changes
  useEffect(() => {
    const formationData = FORMATIONS[formation] || FORMATIONS['4-4-2'];
    const positions = formationData.positions;

    // Clear old players
    homePlayersRef.current.forEach(player => sceneRef.current?.remove(player));
    awayPlayersRef.current.forEach(player => sceneRef.current?.remove(player));
    homePlayersRef.current = [];
    awayPlayersRef.current = [];

    if (!sceneRef.current) return;

    // Create home players
    positions.forEach((pos, index) => {
      const x = ((pos.x - 50) / 50) * 15;
      const z = ((pos.y - 50) / 50) * 10;
      const player = createPlayerMesh(x, z, 0x3b82f6);
      sceneRef.current.add(player);
      homePlayersRef.current.push(player);
    });

    // Create away players
    positions.forEach((pos, index) => {
      const x = ((50 - pos.x) / 50) * 15;
      const z = ((50 - pos.y) / 50) * 10;
      const player = createPlayerMesh(x, z, 0xef4444);
      sceneRef.current.add(player);
      awayPlayersRef.current.push(player);
    });
  }, [formation]);

  // Update ball position
  useEffect(() => {
    if (!ballRef.current || !ballPossession) return;

    const { team, playerIndex } = ballPossession;
    const players = team === 'home' ? homePlayersRef.current : awayPlayersRef.current;
    const player = players[playerIndex];

    if (player) {
      ballRef.current.position.x = player.position.x;
      ballRef.current.position.z = player.position.z;
      ballRef.current.position.y = 0.15;
    }
  }, [ballPossession]);

  return <div ref={mountRef} style={{ width: '100%', height: '600px' }} />;
}

function createPlayerMesh(x, z, color) {
  const group = new THREE.Group();

  // Body
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.35, 0.6, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
  );
  body.position.y = 0.3;
  group.add(body);

  // Head
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffcc99 })
  );
  head.position.y = 0.75;
  group.add(head);

  group.position.set(x, 0, z);
  group.castShadow = true;

  return group;
}
