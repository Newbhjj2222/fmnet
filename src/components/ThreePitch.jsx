import {
  useEffect,
  useRef,
  useCallback
} from 'react';

import * as THREE from "three";

import { OrbitControls } from
  "three/examples/jsm/controls/OrbitControls";

export default function ThreePitch({
  homeXI = [],
  awayXI = [],
  playerPositions = {},
  ballAction = null,
  homeColor = "#2563eb",
  awayColor = "#ef4444",
}) {
  const mountRef =
    useRef(null);

  const sceneRef =
    useRef(null);

  const cameraRef =
    useRef(null);

  const rendererRef =
    useRef(null);

  const controlsRef =
    useRef(null);

  const homePlayersRef =
    useRef(new Map());

  const awayPlayersRef =
    useRef(new Map());

  const ballRef =
    useRef(null);

  const currentPositionsRef =
    useRef({});

  const animationRef =
    useRef(null);

  const lastBallActionRef =
    useRef(0);

  // ==========================================================
  // CREATE SCENE
  // ==========================================================

  useEffect(() => {
    if (!mountRef.current) {
      return;
    }

    const container =
      mountRef.current;

    const width =
      container.clientWidth ||
      900;

    const height =
      container.clientHeight ||
      520;

    // --------------------------------------------------------
    // SCENE
    // --------------------------------------------------------

    const scene =
      new THREE.Scene();

    scene.background =
      new THREE.Color(
        0x050816
      );

    sceneRef.current =
      scene;

    // --------------------------------------------------------
    // CAMERA
    // --------------------------------------------------------

    const camera =
      new THREE.PerspectiveCamera(
        42,
        width / height,
        0.1,
        100
      );

    camera.position.set(
      0,
      22,
      26
    );

    camera.lookAt(
      0,
      0,
      0
    );

    cameraRef.current =
      camera;

    // --------------------------------------------------------
    // RENDERER
    // --------------------------------------------------------

    const renderer =
      new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
      });

    renderer.setSize(
      width,
      height
    );

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio ||
          1,
        1.8
      )
    );

    renderer.shadowMap.enabled =
      true;

    renderer.shadowMap.type =
      THREE.PCFSoftShadowMap;

    renderer.outputColorSpace =
      THREE.SRGBColorSpace;

    container.appendChild(
      renderer.domElement
    );

    rendererRef.current =
      renderer;

    // --------------------------------------------------------
    // CONTROLS
    // --------------------------------------------------------

    const controls =
      new OrbitControls(
        camera,
        renderer.domElement
      );

    controls.enableDamping =
      true;

    controls.dampingFactor =
      0.07;

    controls.enablePan =
      false;

    controls.minDistance =
      15;

    controls.maxDistance =
      40;

    controls.maxPolarAngle =
      Math.PI / 2.35;

    controls.minPolarAngle =
      Math.PI / 4.5;

    controls.target.set(
      0,
      0,
      0
    );

    controls.update();

    controlsRef.current =
      controls;

    // --------------------------------------------------------
    // LIGHTING
    // --------------------------------------------------------

    const ambient =
      new THREE.AmbientLight(
        0xffffff,
        1.2
      );

    scene.add(
      ambient
    );

    const directional =
      new THREE.DirectionalLight(
        0xffffff,
        1.8
      );

    directional.position.set(
      5,
      25,
      10
    );

    directional.castShadow =
      true;

    scene.add(
      directional
    );

    // --------------------------------------------------------
    // PITCH
    // --------------------------------------------------------

    const pitch =
      new THREE.Mesh(
        new THREE.PlaneGeometry(
          30,
          20
        ),
        new THREE.MeshStandardMaterial(
          {
            color: 0x126b36,
            roughness: 0.85,
          }
        )
      );

    pitch.rotation.x =
      -Math.PI / 2;

    pitch.receiveShadow =
      true;

    scene.add(
      pitch
    );

    // --------------------------------------------------------
    // PITCH STRIPES
    // --------------------------------------------------------

    for (
      let i = -15;
      i < 15;
      i += 3
    ) {
      const stripe =
        new THREE.Mesh(
          new THREE.PlaneGeometry(
            3,
            20
          ),
          new THREE.MeshBasicMaterial(
            {
              color:
                i % 6 === 0
                  ? 0x16763b
                  : 0x126b36,
            }
          )
        );

      stripe.rotation.x =
        -Math.PI / 2;

      stripe.position.set(
        i + 1.5,
        0.005,
        0
      );

      scene.add(
        stripe
      );
    }

    // --------------------------------------------------------
    // LINE MATERIAL
    // --------------------------------------------------------

    const lineMaterial =
      new THREE.LineBasicMaterial(
        {
          color: 0xffffff,
        }
      );

    // --------------------------------------------------------
    // OUTER BORDER
    // --------------------------------------------------------

    const borderGeometry =
      new THREE.BufferGeometry().setFromPoints(
        [
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
        ]
      );

    scene.add(
      new THREE.Line(
        borderGeometry,
        lineMaterial
      )
    );

    // --------------------------------------------------------
    // CENTER LINE
    // --------------------------------------------------------

    const centerGeometry =
      new THREE.BufferGeometry().setFromPoints(
        [
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
        ]
      );

    scene.add(
      new THREE.Line(
        centerGeometry,
        lineMaterial
      )
    );

    // --------------------------------------------------------
    // CENTER CIRCLE
    // --------------------------------------------------------

    const circle =
      new THREE.Mesh(
        new THREE.RingGeometry(
          2.9,
          3.02,
          64
        ),
        new THREE.MeshBasicMaterial(
          {
            color: 0xffffff,
            side: THREE.DoubleSide,
          }
        )
      );

    circle.rotation.x =
      -Math.PI / 2;

    circle.position.y =
      0.035;

    scene.add(
      circle
    );

    // --------------------------------------------------------
    // PENALTY AREAS
    // --------------------------------------------------------

    const addPenaltyBox =
      (side) => {
        const x =
          side === "left"
            ? -11
            : 11;

        const points = [
          new THREE.Vector3(
            x,
            0.04,
            -5
          ),

          new THREE.Vector3(
            side === "left"
              ? -6
              : 6,
            0.04,
            -5
          ),

          new THREE.Vector3(
            side === "left"
              ? -6
              : 6,
            0.04,
            5
          ),

          new THREE.Vector3(
            x,
            0.04,
            5
          ),
        ];

        const geometry =
          new THREE.BufferGeometry().setFromPoints(
            points
          );

        scene.add(
          new THREE.Line(
            geometry,
            lineMaterial
          )
        );
      };

    addPenaltyBox(
      "left"
    );

    addPenaltyBox(
      "right"
    );

    // --------------------------------------------------------
    // GOALS
    // --------------------------------------------------------

    const goalMaterial =
      new THREE.MeshStandardMaterial(
        {
          color: 0xffffff,
          roughness: 0.3,
        }
      );

    const leftGoal =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.35,
          1.0,
          6
        ),
        goalMaterial
      );

    leftGoal.position.set(
      -15.15,
      0.5,
      0
    );

    scene.add(
      leftGoal
    );

    const rightGoal =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.35,
          1.0,
          6
        ),
        goalMaterial
      );

    rightGoal.position.set(
      15.15,
      0.5,
      0
    );

    scene.add(
      rightGoal
    );

    // --------------------------------------------------------
    // BALL
    // --------------------------------------------------------

    const ball =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.22,
          16,
          16
        ),
        new THREE.MeshStandardMaterial(
          {
            color: 0xffffff,
            roughness: 0.25,
          }
        )
      );

    ball.position.set(
      0,
      0.25,
      0
    );

    ball.castShadow =
      true;

    scene.add(
      ball
    );

    ballRef.current =
      ball;

    // --------------------------------------------------------
    // ANIMATION LOOP
    // --------------------------------------------------------

    const animate =
      () => {
        animationRef.current =
          requestAnimationFrame(
            animate
          );

        controls.update();

        // ----------------------------------------------
        // SMOOTH PLAYER MOVEMENT
        // ----------------------------------------------

        const allPlayers = [
          ...homePlayersRef.current.values(),
          ...awayPlayersRef.current.values(),
        ];

        allPlayers.forEach(
          (group) => {
            const key =
              group.userData.key;

            const target =
              currentPositionsRef.current[
                key
              ];

            if (!target) {
              return;
            }

            group.position.x +=
              (target.x -
                group.position.x) *
              0.08;

            group.position.z +=
              (target.z -
                group.position.z) *
              0.08;

            // Small natural movement
            group.rotation.y +=
              0.002;
          }
        );

        renderer.render(
          scene,
          camera
        );
      };

    animate();

    // --------------------------------------------------------
    // RESIZE
    // --------------------------------------------------------

    const resize =
      () => {
        if (!mountRef.current) {
          return;
        }

        const w =
          mountRef.current
            .clientWidth ||
          900;

        const h =
          mountRef.current
            .clientHeight ||
          520;

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
      resize
    );

    // --------------------------------------------------------
    // CLEANUP
    // --------------------------------------------------------

    return () => {
      window.removeEventListener(
        "resize",
        resize
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
        container
      ) {
        container.removeChild(
          renderer.domElement
        );
      }

      scene.traverse(
        (object) => {
          if (
            object.geometry
          ) {
            object.geometry.dispose();
          }

          if (
            object.material
          ) {
            if (
              Array.isArray(
                object.material
              )
            ) {
              object.material.forEach(
                (material) =>
                  material.dispose()
              );
            } else {
              object.material.dispose();
            }
          }
        }
      );

      scene.clear();

      homePlayersRef.current.clear();

      awayPlayersRef.current.clear();

      sceneRef.current =
        null;

      rendererRef.current =
        null;
    };
  }, []);

  // ==========================================================
  // UPDATE POSITIONS
  // ==========================================================

  useEffect(() => {
    currentPositionsRef.current =
      playerPositions || {};
  }, [
    playerPositions,
  ]);

  // ==========================================================
  // PLAYER FACTORY
  // ==========================================================

  const createPlayer =
    (
      player,
      color,
      team,
      index
    ) => {
      const group =
        new THREE.Group();

      const bodyMaterial =
        new THREE.MeshStandardMaterial(
          {
            color: new THREE.Color(
              color
            ),
            roughness: 0.5,
          }
        );

      const body =
        new THREE.Mesh(
          new THREE.CylinderGeometry(
            0.28,
            0.36,
            0.65,
            12
          ),
          bodyMaterial
        );

      body.position.y =
        0.42;

      body.castShadow =
        true;

      group.add(
        body
      );

      const headMaterial =
        new THREE.MeshStandardMaterial(
          {
            color: 0xffc9a4,
          }
        );

      const head =
        new THREE.Mesh(
          new THREE.SphereGeometry(
            0.18,
            12,
            12
          ),
          headMaterial
        );

      head.position.y =
        0.88;

      head.castShadow =
        true;

      group.add(
        head
      );

      // ----------------------------------------------
      // PLAYER BASE
      // ----------------------------------------------

      const base =
        new THREE.Mesh(
          new THREE.CylinderGeometry(
            0.43,
            0.43,
            0.04,
            16
          ),
          new THREE.MeshBasicMaterial(
            {
              color:
                team === "home"
                  ? 0x60a5fa
                  : 0xf87171,
              transparent: true,
              opacity: 0.35,
            }
          )
        );

      base.position.y =
        0.03;

      group.add(
        base
      );

      group.userData = {
        playerId:
          player?.id ||
          player?.playerId ||
          `player-${index}`,
        team,
        key: `${team}-${
          player?.id ||
          player?.playerId ||
          `player-${index}`
        }`,
      };

      return group;
    };

  // ==========================================================
  // CREATE / RECREATE PLAYERS
  // ==========================================================

  useEffect(() => {
    const scene =
      sceneRef.current;

    if (!scene) {
      return;
    }

    // Remove old
    homePlayersRef.current.forEach(
      (player) => {
        scene.remove(
          player
        );
      }
    );

    awayPlayersRef.current.forEach(
      (player) => {
        scene.remove(
          player
        );
      }
    );

    homePlayersRef.current.clear();

    awayPlayersRef.current.clear();

    // Home
    homeXI.forEach(
      (
        player,
        index
      ) => {
        const id =
          player?.id ||
          player?.playerId ||
          `player-${index}`;

        const key =
          `home-${id}`;

        const group =
          createPlayer(
            player,
            homeColor,
            "home",
            index
          );

        const target =
          playerPositions[
            key
          ] || {
            x: -5,
            z: 0,
          };

        group.position.set(
          target.x,
          0,
          target.z
        );

        scene.add(
          group
        );

        homePlayersRef.current.set(
          String(id),
          group
        );
      }
    );

    // Away
    awayXI.forEach(
      (
        player,
        index
      ) => {
        const id =
          player?.id ||
          player?.playerId ||
          `player-${index}`;

        const key =
          `away-${id}`;

        const group =
          createPlayer(
            player,
            awayColor,
            "away",
            index
          );

        const target =
          playerPositions[
            key
          ] || {
            x: 5,
            z: 0,
          };

        group.position.set(
          target.x,
          0,
          target.z
        );

        scene.add(
          group
        );

        awayPlayersRef.current.set(
          String(id),
          group
        );
      }
    );
  }, [
    homeXI,
    awayXI,
    homeColor,
    awayColor,
  ]);

  // ==========================================================
  // BALL PASS / SHOT ANIMATION
  // ==========================================================

  useEffect(() => {
    if (
      !ballAction ||
      !ballRef.current
    ) {
      return;
    }

    if (
      ballAction.id ===
      lastBallActionRef.current
    ) {
      return;
    }

    lastBallActionRef.current =
      ballAction.id;

    const ball =
      ballRef.current;

    const from =
      ballAction.from || [
        0,
        0,
      ];

    const to =
      ballAction.to || [
        0,
        0,
      ];

    const startX =
      from[0];

    const startZ =
      from[1];

    const endX =
      to[0];

    const endZ =
      to[1];

    const startTime =
      performance.now();

    const duration =
      ballAction.type ===
      "shot"
        ? 750
        : ballAction.type ===
          "dribble"
        ? 450
        : 550;

    let frame;

    const animateBall =
      (time) => {
        const progress =
          Math.min(
            (time -
              startTime) /
              duration,
            1
          );

        const eased =
          1 -
          Math.pow(
            1 - progress,
            3
          );

        ball.position.x =
          startX +
          (endX -
            startX) *
            eased;

        ball.position.z =
          startZ +
          (endZ -
            startZ) *
            eased;

        if (
          ballAction.type ===
          "shot"
        ) {
          ball.position.y =
            0.25 +
            Math.sin(
              progress *
                Math.PI
            ) *
              0.8;
        } else {
          ball.position.y =
            0.25 +
            Math.sin(
              progress *
                Math.PI *
                3
            ) *
              0.18;
        }

        if (
          progress <
          1
        ) {
          frame =
            requestAnimationFrame(
              animateBall
            );
        } else {
          ball.position.x =
            endX;

          ball.position.z =
            endZ;

          ball.position.y =
            0.25;
        }
      };

    frame =
      requestAnimationFrame(
        animateBall
      );

    return () => {
      if (frame) {
        cancelAnimationFrame(
          frame
        );
      }
    };
  }, [
    ballAction,
  ]);

  return (
    <div
      ref={mountRef}
      style={{
        width: "100%",
        height: "520px",
        minHeight: "420px",
        overflow: "hidden",
        borderRadius: "18px",
      }}
    />
  );
}
