// components/ThreePitch.jsx

import {
  useEffect,
  useRef,
} from "react";

import * as THREE from "three";

import { OrbitControls } from
  "three/examples/jsm/controls/OrbitControls";

export default function ThreePitch({
  playerStates = {
    home: [],
    away: [],
  },

  ballState = null,

  homeColor = "#2563eb",

  awayColor = "#dc2626",

  lastAction = null,
}) {
  const mountRef =
    useRef(null);

  const sceneRef =
    useRef(null);

  const rendererRef =
    useRef(null);

  const cameraRef =
    useRef(null);

  const controlsRef =
    useRef(null);

  const playerMeshesRef =
    useRef(new Map());

  const ballRef =
    useRef(null);

  const animationRef =
    useRef(null);

  const ballTargetRef =
    useRef({
      x: 0,
      z: 0,
    });

  // ==========================================================
  // CREATE SCENE
  // ==========================================================

  useEffect(() => {
    if (!mountRef.current) {
      return;
    }

    const mount =
      mountRef.current;

    const width =
      mount.clientWidth || 900;

    const height =
      mount.clientHeight || 560;

    const scene =
      new THREE.Scene();

    scene.background =
      new THREE.Color(
        0x07111f
      );

    sceneRef.current = scene;

    // Camera
    const camera =
      new THREE.PerspectiveCamera(
        45,
        width / height,
        0.1,
        100
      );

    camera.position.set(
      0,
      22,
      25
    );

    camera.lookAt(
      0,
      0,
      0
    );

    cameraRef.current =
      camera;

    // Renderer
    const renderer =
      new THREE.WebGLRenderer({
        antialias: true,
      });

    renderer.setSize(
      width,
      height
    );

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        2
      )
    );

    renderer.shadowMap.enabled =
      true;

    mount.appendChild(
      renderer.domElement
    );

    rendererRef.current =
      renderer;

    // Controls
    const controls =
      new OrbitControls(
        camera,
        renderer.domElement
      );

    controls.enableDamping =
      true;

    controls.dampingFactor =
      0.07;

    controls.target.set(
      0,
      0,
      0
    );

    controls.minDistance =
      16;

    controls.maxDistance =
      42;

    controls.maxPolarAngle =
      Math.PI / 2.15;

    controls.update();

    controlsRef.current =
      controls;

    // ========================================================
    // LIGHTS
    // ========================================================

    const ambient =
      new THREE.AmbientLight(
        0xffffff,
        0.8
      );

    scene.add(ambient);

    const light =
      new THREE.DirectionalLight(
        0xffffff,
        1.4
      );

    light.position.set(
      5,
      25,
      10
    );

    light.castShadow = true;

    scene.add(light);

    // ========================================================
    // PITCH
    // ========================================================

    const pitch =
      new THREE.Mesh(
        new THREE.PlaneGeometry(
          30,
          20
        ),
        new THREE.MeshStandardMaterial({
          color: 0x15803d,
          roughness: 0.85,
        })
      );

    pitch.rotation.x =
      -Math.PI / 2;

    pitch.receiveShadow =
      true;

    scene.add(pitch);

    // ========================================================
    // FIELD LINES
    // ========================================================

    const lineMaterial =
      new THREE.LineBasicMaterial({
        color: 0xffffff,
      });

    const addLine = (
      points
    ) => {
      const geometry =
        new THREE.BufferGeometry()
          .setFromPoints(
            points
          );

      const line =
        new THREE.Line(
          geometry,
          lineMaterial
        );

      scene.add(line);
    };

    // Border
    addLine([
      new THREE.Vector3(
        -15,
        0.03,
        -10
      ),

      new THREE.Vector3(
        15,
        0.03,
        -10
      ),

      new THREE.Vector3(
        15,
        0.03,
        10
      ),

      new THREE.Vector3(
        -15,
        0.03,
        10
      ),

      new THREE.Vector3(
        -15,
        0.03,
        -10
      ),
    ]);

    // Center line
    addLine([
      new THREE.Vector3(
        0,
        0.03,
        -10
      ),

      new THREE.Vector3(
        0,
        0.03,
        10
      ),
    ]);

    // Center circle
    const centerCircle =
      new THREE.Mesh(
        new THREE.RingGeometry(
          3,
          3.06,
          64
        ),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
        })
      );

    centerCircle.rotation.x =
      -Math.PI / 2;

    centerCircle.position.y =
      0.04;

    scene.add(centerCircle);

    // ========================================================
    // PENALTY AREAS
    // ========================================================

    addLine([
      new THREE.Vector3(
        -15,
        0.04,
        -5
      ),

      new THREE.Vector3(
        -9,
        0.04,
        -5
      ),

      new THREE.Vector3(
        -9,
        0.04,
        5
      ),

      new THREE.Vector3(
        -15,
        0.04,
        5
      ),
    ]);

    addLine([
      new THREE.Vector3(
        15,
        0.04,
        -5
      ),

      new THREE.Vector3(
        9,
        0.04,
        -5
      ),

      new THREE.Vector3(
        9,
        0.04,
        5
      ),

      new THREE.Vector3(
        15,
        0.04,
        5
      ),
    ]);

    // ========================================================
    // GOALS
    // ========================================================

    const goalMaterial =
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
      });

    const createGoal = (
      x
    ) => {
      const goal =
        new THREE.Mesh(
          new THREE.BoxGeometry(
            0.5,
            1.2,
            6
          ),
          goalMaterial
        );

      goal.position.set(
        x,
        0.6,
        0
      );

      scene.add(goal);
    };

    createGoal(-15.2);
    createGoal(15.2);

    // ========================================================
    // BALL
    // ========================================================

    const ball =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.18,
          24,
          24
        ),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.25,
        })
      );

    ball.position.set(
      0,
      0.18,
      0
    );

    ball.castShadow =
      true;

    scene.add(ball);

    ballRef.current =
      ball;

    // ========================================================
    // ANIMATION
    // ========================================================

    const animate = () => {
      animationRef.current =
        requestAnimationFrame(
          animate
        );

      controls.update();

      // --------------------------------
      // Player interpolation
      // --------------------------------

      for (const mesh of
        playerMeshesRef.current.values()) {

        const target =
          mesh.userData.target;

        if (!target) continue;

        mesh.position.x +=
          (target.x -
            mesh.position.x) *
          0.09;

        mesh.position.z +=
          (target.z -
            mesh.position.z) *
          0.09;

        // Small running animation
        if (
          mesh.userData.running
        ) {
          mesh.rotation.y +=
            0.025;
        }
      }

      // --------------------------------
      // Ball interpolation
      // --------------------------------

      if (ballRef.current) {
        const ball =
          ballRef.current;

        ball.position.x +=
          (
            ballTargetRef.current.x -
            ball.position.x
          ) * 0.22;

        ball.position.z +=
          (
            ballTargetRef.current.z -
            ball.position.z
          ) * 0.22;

        ball.position.y =
          0.18 +
          Math.sin(
            Date.now() * 0.01
          ) * 0.025;
      }

      renderer.render(
        scene,
        camera
      );
    };

    animate();

    // ========================================================
    // RESIZE
    // ========================================================

    const handleResize = () => {
      if (!mountRef.current) {
        return;
      }

      const w =
        mountRef.current
          .clientWidth || 900;

      const h =
        mountRef.current
          .clientHeight || 560;

      camera.aspect =
        w / h;

      camera.updateProjectionMatrix();

      renderer.setSize(
        w,
        h
      );
    };

    window.addEventListener(
      "resize",
      handleResize
    );

    // ========================================================
    // CLEANUP
    // ========================================================

    return () => {
      window.removeEventListener(
        "resize",
        handleResize
      );

      if (
        animationRef.current
      ) {
        cancelAnimationFrame(
          animationRef.current
        );
      }

      controls.dispose();

      renderer.dispose();

      if (
        renderer.domElement.parentNode ===
        mount
      ) {
        mount.removeChild(
          renderer.domElement
        );
      }

      playerMeshesRef.current.clear();

      scene.clear();
    };
  }, []);

  // ==========================================================
  // CREATE / UPDATE PLAYERS
  // ==========================================================

  useEffect(() => {
    const scene =
      sceneRef.current;

    if (!scene) return;

    const allPlayers = [
      ...(playerStates.home || []),
      ...(playerStates.away || []),
    ];

    const activeKeys =
      new Set();

    const createPlayer = (
      player
    ) => {
      const group =
        new THREE.Group();

      const color =
        player.team === "home"
          ? homeColor
          : awayColor;

      // Body
      const body =
        new THREE.Mesh(
          new THREE.CylinderGeometry(
            0.32,
            0.38,
            0.65,
            16
          ),
          new THREE.MeshStandardMaterial({
            color,
            roughness: 0.5,
          })
        );

      body.position.y =
        0.35;

      body.castShadow =
        true;

      group.add(body);

      // Head
      const head =
        new THREE.Mesh(
          new THREE.SphereGeometry(
            0.17,
            16,
            16
          ),
          new THREE.MeshStandardMaterial({
            color: 0xf2c29b,
          })
        );

      head.position.y =
        0.82;

      head.castShadow =
        true;

      group.add(head);

      group.position.set(
        player.x,
        0,
        player.z
      );

      group.userData.target = {
        x: player.x,
        z: player.z,
      };

      group.userData.running =
        false;

      return group;
    };

    for (const player of
      allPlayers) {

      const key =
        `${player.team}-${player.id}`;

      activeKeys.add(key);

      let mesh =
        playerMeshesRef.current.get(
          key
        );

      if (!mesh) {
        mesh =
          createPlayer(player);

        scene.add(mesh);

        playerMeshesRef.current.set(
          key,
          mesh
        );
      }

      mesh.userData.target = {
        x: player.x,
        z: player.z,
      };

      mesh.userData.running =
        true;

      // Update jersey color
      const body =
        mesh.children[0];

      if (
        body?.material?.color
      ) {
        body.material.color.set(
          player.team === "home"
            ? homeColor
            : awayColor
        );
      }

      // If player has ball,
      // make him slightly bigger.
      const scale =
        player.hasBall
          ? 1.12
          : 1;

      mesh.scale.set(
        scale,
        scale,
        scale
      );
    }

    // Remove players that
    // are no longer in lineup.
    for (
      const [key, mesh] of
      playerMeshesRef.current
    ) {
      if (!activeKeys.has(key)) {
        scene.remove(mesh);
        playerMeshesRef.current.delete(
          key
        );
      }
    }
  }, [
    playerStates,
    homeColor,
    awayColor,
  ]);

  // ==========================================================
  // BALL
  // ==========================================================

  useEffect(() => {
    if (!ballState) return;

    ballTargetRef.current = {
      x: Number(ballState.targetX ?? ballState.x ?? 0),
      z: Number(ballState.targetZ ?? ballState.z ?? 0),
    };
  }, [ballState]);

  // ==========================================================
  // ACTION EFFECT
  // ==========================================================

  useEffect(() => {
    if (!lastAction) return;

    if (
      lastAction.toX !== undefined &&
      lastAction.toZ !== undefined
    ) {
      ballTargetRef.current = {
        x: Number(lastAction.toX),
        z: Number(lastAction.toZ),
      };
    }

    if (
      lastAction.targetX !== undefined &&
      lastAction.targetZ !== undefined
    ) {
      ballTargetRef.current = {
        x: Number(lastAction.targetX),
        z: Number(lastAction.targetZ),
      };
    }
  }, [lastAction]);

  return (
    <div
      ref={mountRef}
      style={{
        width: "100%",
        height: "560px",
        minHeight: "420px",
        borderRadius: "18px",
        overflow: "hidden",
        background: "#07111f",
      }}
    />
  );
}
