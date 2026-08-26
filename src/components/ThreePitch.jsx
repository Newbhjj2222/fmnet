// components/ThreePitch.jsx

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default function ThreePitch({
  homeXI = [],
  awayXI = [],
  homeColor = '#3b82f6',
  awayColor = '#ef4444',
  formation = '4-4-2',
  lastAction = null,
  isPaused = false,
}) {
  const mountRef = useRef(null);

  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);

  const homePlayersRef = useRef([]);
  const awayPlayersRef = useRef([]);

  const ballRef = useRef(null);

  const animationFrameRef = useRef(null);

  const actionRef = useRef(null);
  const actionStartRef = useRef(0);

  // ============================================================
  // FORMATIONS
  // ============================================================

  const getFormationPositions = useCallback((formationName) => {
    const formations = {
      '4-4-2': [
        { x: 8, y: 50 },

        { x: 23, y: 18 },
        { x: 23, y: 39 },
        { x: 23, y: 61 },
        { x: 23, y: 82 },

        { x: 42, y: 20 },
        { x: 42, y: 42 },
        { x: 42, y: 58 },
        { x: 42, y: 80 },

        { x: 62, y: 36 },
        { x: 62, y: 64 },
      ],

      '4-3-3': [
        { x: 8, y: 50 },

        { x: 23, y: 18 },
        { x: 23, y: 39 },
        { x: 23, y: 61 },
        { x: 23, y: 82 },

        { x: 42, y: 30 },
        { x: 42, y: 50 },
        { x: 42, y: 70 },

        { x: 64, y: 20 },
        { x: 64, y: 50 },
        { x: 64, y: 80 },
      ],

      '3-5-2': [
        { x: 8, y: 50 },

        { x: 23, y: 30 },
        { x: 23, y: 50 },
        { x: 23, y: 70 },

        { x: 42, y: 20 },
        { x: 42, y: 39 },
        { x: 42, y: 50 },
        { x: 42, y: 61 },
        { x: 42, y: 80 },

        { x: 64, y: 36 },
        { x: 64, y: 64 },
      ],

      '5-3-2': [
        { x: 8, y: 50 },

        { x: 20, y: 12 },
        { x: 20, y: 31 },
        { x: 20, y: 50 },
        { x: 20, y: 69 },
        { x: 20, y: 88 },

        { x: 42, y: 30 },
        { x: 42, y: 50 },
        { x: 42, y: 70 },

        { x: 64, y: 36 },
        { x: 64, y: 64 },
      ],
    };

    return formations[formationName] || formations['4-4-2'];
  }, []);

  // ============================================================
  // PLAYER POSITION
  // ============================================================

  const convertPosition = useCallback((position, isHome) => {
    let x = ((position.x - 50) / 50) * 15;
    let z = ((position.y - 50) / 50) * 10;

    if (!isHome) {
      x = -x;
      z = -z;
    }

    return {
      x,
      z,
    };
  }, []);

  // ============================================================
  // FIND PLAYER OBJECT
  // ============================================================

  const findPlayerObject = useCallback((team, playerId) => {
    const players =
      team === 'home'
        ? homePlayersRef.current
        : awayPlayersRef.current;

    return players.find(
      (player) => player.userData.playerId === playerId
    );
  }, []);

  // ============================================================
  // BALL TARGET
  // ============================================================

  const getGoalPosition = useCallback((team) => {
    if (team === 'home') {
      return new THREE.Vector3(15, 0.15, 0);
    }

    return new THREE.Vector3(-15, 0.15, 0);
  }, []);

  // ============================================================
  // CREATE PLAYER
  // ============================================================

  const createPlayer = useCallback((player, x, z, color, team, index) => {
    const group = new THREE.Group();

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
    });

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.3,
        0.35,
        0.6,
        16
      ),
      bodyMaterial
    );

    body.position.y = 0.3;
    body.castShadow = true;

    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.15,
        16,
        16
      ),
      new THREE.MeshStandardMaterial({
        color: 0xffcc99,
      })
    );

    head.position.y = 0.75;
    head.castShadow = true;

    group.add(head);

    group.position.set(x, 0, z);

    group.userData = {
      playerId: player?.id || player?.playerId || `player-${team}-${index}`,
      team,
      index,
      baseX: x,
      baseZ: z,
      targetX: x,
      targetZ: z,
    };

    return group;
  }, []);

  // ============================================================
  // CREATE PITCH
  // ============================================================

  useEffect(() => {
    if (!mountRef.current) return;

    const mount = mountRef.current;

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 500;

    // ----------------------------------------------------------
    // SCENE
    // ----------------------------------------------------------

    const scene = new THREE.Scene();

    scene.background = new THREE.Color(0x0b1120);

    sceneRef.current = scene;

    // ----------------------------------------------------------
    // CAMERA
    // ----------------------------------------------------------

    const camera = new THREE.PerspectiveCamera(
      45,
      width / height,
      0.1,
      100
    );

    camera.position.set(0, 22, 28);

    camera.lookAt(0, 0, 0);

    cameraRef.current = camera;

    // ----------------------------------------------------------
    // RENDERER
    // ----------------------------------------------------------

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
    });

    renderer.setSize(width, height);

    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, 2)
    );

    renderer.shadowMap.enabled = true;

    mount.appendChild(renderer.domElement);

    rendererRef.current = renderer;

    // ----------------------------------------------------------
    // CONTROLS
    // ----------------------------------------------------------

    const controls = new OrbitControls(
      camera,
      renderer.domElement
    );

    controls.enableDamping = true;

    controls.dampingFactor = 0.05;

    controls.target.set(0, 0, 0);

    controls.maxPolarAngle = Math.PI / 2.5;

    controls.minDistance = 15;

    controls.maxDistance = 45;

    controls.update();

    controlsRef.current = controls;

    // ----------------------------------------------------------
    // LIGHTING
    // ----------------------------------------------------------

    const ambient = new THREE.AmbientLight(
      0xffffff,
      0.65
    );

    scene.add(ambient);

    const directional = new THREE.DirectionalLight(
      0xffffff,
      1.2
    );

    directional.position.set(
      10,
      20,
      10
    );

    directional.castShadow = true;

    scene.add(directional);

    // ----------------------------------------------------------
    // PITCH
    // ----------------------------------------------------------

    const pitchGeometry = new THREE.PlaneGeometry(
      30,
      20
    );

    const pitchMaterial =
      new THREE.MeshStandardMaterial({
        color: 0x15803d,
        roughness: 0.8,
      });

    const pitch = new THREE.Mesh(
      pitchGeometry,
      pitchMaterial
    );

    pitch.rotation.x = -Math.PI / 2;

    pitch.receiveShadow = true;

    scene.add(pitch);

    // ----------------------------------------------------------
    // FIELD LINES
    // ----------------------------------------------------------

    const lineMaterial =
      new THREE.LineBasicMaterial({
        color: 0xffffff,
      });

    // Outer border

    const borderGeometry =
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-15, 0.02, -10),
        new THREE.Vector3(15, 0.02, -10),
        new THREE.Vector3(15, 0.02, 10),
        new THREE.Vector3(-15, 0.02, 10),
        new THREE.Vector3(-15, 0.02, -10),
      ]);

    scene.add(
      new THREE.Line(
        borderGeometry,
        lineMaterial
      )
    );

    // Center line

    const centerGeometry =
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.02, -10),
        new THREE.Vector3(0, 0.02, 10),
      ]);

    scene.add(
      new THREE.Line(
        centerGeometry,
        lineMaterial
      )
    );

    // Center circle

    const centerCircle = new THREE.Mesh(
      new THREE.RingGeometry(
        3,
        3.05,
        64
      ),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
      })
    );

    centerCircle.rotation.x = -Math.PI / 2;

    centerCircle.position.y = 0.025;

    scene.add(centerCircle);

    // ----------------------------------------------------------
    // PENALTY BOXES
    // ----------------------------------------------------------

    const createBox = (x) => {
      const geometry =
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x, 0.025, -5),
          new THREE.Vector3(
            x > 0 ? x - 5 : x + 5,
            0.025,
            -5
          ),
          new THREE.Vector3(
            x > 0 ? x - 5 : x + 5,
            0.025,
            5
          ),
          new THREE.Vector3(x, 0.025, 5),
        ]);

      scene.add(
        new THREE.LineLoop(
          geometry,
          lineMaterial
        )
      );
    };

    createBox(-15);
    createBox(15);

    // ----------------------------------------------------------
    // GOALS
    // ----------------------------------------------------------

    const goalMaterial =
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
      });

    const leftGoal = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.15,
        1.5,
        6
      ),
      goalMaterial
    );

    leftGoal.position.set(
      -15,
      0.75,
      0
    );

    scene.add(leftGoal);

    const rightGoal = new THREE.Mesh(
      new THREE.BoxGeometry(
        0.15,
        1.5,
        6
      ),
      goalMaterial
    );

    rightGoal.position.set(
      15,
      0.75,
      0
    );

    scene.add(rightGoal);

    // ----------------------------------------------------------
    // BALL
    // ----------------------------------------------------------

    const ball = new THREE.Mesh(
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

    ball.castShadow = true;

    scene.add(ball);

    ballRef.current = ball;

    // ----------------------------------------------------------
    // ANIMATION
    // ----------------------------------------------------------

    const animate = (time) => {
      animationFrameRef.current =
        requestAnimationFrame(animate);

      controls.update();

      const currentAction = actionRef.current;

      if (
        currentAction &&
        !isPaused
      ) {
        const elapsed =
          time - actionStartRef.current;

        const duration =
          currentAction.duration || 900;

        const progress = Math.min(
          elapsed / duration,
          1
        );

        const eased =
          progress < 0.5
            ? 2 * progress * progress
            : 1 -
              Math.pow(
                -2 * progress + 2,
                2
              ) / 2;

        // ------------------------------------------------------
        // BALL
        // ------------------------------------------------------

        if (
          ballRef.current &&
          currentAction.from &&
          currentAction.to
        ) {
          const from =
            currentAction.from;

          const to =
            currentAction.to;

          const x =
            from.x +
            (to.x - from.x) *
              eased;

          const z =
            from.z +
            (to.z - from.z) *
              eased;

          ballRef.current.position.x = x;

          ballRef.current.position.z = z;

          // Ball jumps slightly while moving

          ballRef.current.position.y =
            0.18 +
            Math.sin(progress * Math.PI) *
              0.18;

          ballRef.current.rotation.x +=
            0.12;

          ballRef.current.rotation.z +=
            0.12;
        }

        // ------------------------------------------------------
        // ACTIVE PLAYER MOVEMENT
        // ------------------------------------------------------

        const activePlayer =
          currentAction.playerId
            ? findPlayerObject(
                currentAction.team,
                currentAction.playerId
              )
            : null;

        if (activePlayer) {
          const target =
            currentAction.to;

          if (target) {
            activePlayer.position.x =
              activePlayer.userData.baseX +
              (target.x -
                activePlayer.userData.baseX) *
                Math.min(eased * 1.4, 1);

            activePlayer.position.z =
              activePlayer.userData.baseZ +
              (target.z -
                activePlayer.userData.baseZ) *
                Math.min(eased * 1.4, 1);
          }
        }

        // ------------------------------------------------------
        // TARGET PLAYER
        // ------------------------------------------------------

        if (
          currentAction.targetPlayerId
        ) {
          const targetPlayer =
            findPlayerObject(
              currentAction.team,
              currentAction.targetPlayerId
            );

          if (targetPlayer) {
            targetPlayer.position.y =
              Math.sin(
                progress * Math.PI
              ) * 0.08;
          }
        }

        // ------------------------------------------------------
        // SHOT / GOAL
        // ------------------------------------------------------

        if (
          currentAction.type ===
            'shot' ||
          currentAction.type ===
            'goal'
        ) {
          if (ballRef.current) {
            ballRef.current.position.y =
              0.18 +
              Math.sin(
                progress * Math.PI
              ) *
                0.5;
          }
        }

        // ------------------------------------------------------
        // FINISH ACTION
        // ------------------------------------------------------

        if (progress >= 1) {
          actionRef.current = null;

          if (ballRef.current) {
            ballRef.current.position.y =
              0.18;
          }
        }
      }

      // --------------------------------------------------------
      // SMALL NATURAL MOVEMENT
      // --------------------------------------------------------

      if (!isPaused) {
        const seconds =
          time * 0.001;

        homePlayersRef.current.forEach(
          (player, index) => {
            if (
              currentAction?.playerId ===
                player.userData.playerId &&
              currentAction?.team === 'home'
            ) {
              return;
            }

            player.position.x =
              player.userData.baseX +
              Math.sin(
                seconds * 0.7 + index
              ) *
                0.08;

            player.position.z =
              player.userData.baseZ +
              Math.cos(
                seconds * 0.6 + index
              ) *
                0.08;
          }
        );

        awayPlayersRef.current.forEach(
          (player, index) => {
            if (
              currentAction?.playerId ===
                player.userData.playerId &&
              currentAction?.team === 'away'
            ) {
              return;
            }

            player.position.x =
              player.userData.baseX +
              Math.sin(
                seconds * 0.65 + index
              ) *
                0.08;

            player.position.z =
              player.userData.baseZ +
              Math.cos(
                seconds * 0.55 + index
              ) *
                0.08;
          }
        );
      }

      renderer.render(
        scene,
        camera
      );
    };

    animationFrameRef.current =
      requestAnimationFrame(animate);

    // ----------------------------------------------------------
    // RESIZE
    // ----------------------------------------------------------

    const handleResize = () => {
      if (!mountRef.current) return;

      const w =
        mountRef.current.clientWidth ||
        800;

      const h =
        mountRef.current.clientHeight ||
        500;

      camera.aspect = w / h;

      camera.updateProjectionMatrix();

      renderer.setSize(
        w,
        h
      );
    };

    window.addEventListener(
      'resize',
      handleResize
    );

    // ----------------------------------------------------------
    // CLEANUP
    // ----------------------------------------------------------

    return () => {
      window.removeEventListener(
        'resize',
        handleResize
      );

      if (
        animationFrameRef.current
      ) {
        cancelAnimationFrame(
          animationFrameRef.current
        );
      }

      controls.dispose();

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

      renderer.dispose();

      if (
        mount &&
        renderer.domElement.parentNode ===
          mount
      ) {
        mount.removeChild(
          renderer.domElement
        );
      }

      scene.clear();

      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      ballRef.current = null;
    };
  }, [findPlayerObject, isPaused]);

  // ============================================================
  // CREATE / UPDATE PLAYERS
  // ============================================================

  useEffect(() => {
    if (!sceneRef.current) return;

    const scene =
      sceneRef.current;

    const positions =
      getFormationPositions(
        formation
      );

    // ----------------------------------------------------------
    // REMOVE OLD PLAYERS
    // ----------------------------------------------------------

    homePlayersRef.current.forEach(
      (player) => {
        scene.remove(player);

        player.traverse(
          (object) => {
            if (
              object.geometry
            ) {
              object.geometry.dispose();
            }

            if (
              object.material
            ) {
              object.material.dispose();
            }
          }
        );
      }
    );

    awayPlayersRef.current.forEach(
      (player) => {
        scene.remove(player);

        player.traverse(
          (object) => {
            if (
              object.geometry
            ) {
              object.geometry.dispose();
            }

            if (
              object.material
            ) {
              object.material.dispose();
            }
          }
        );
      }
    );

    homePlayersRef.current = [];
    awayPlayersRef.current = [];

    // ----------------------------------------------------------
    // HOME XI
    // ----------------------------------------------------------

    positions.forEach(
      (position, index) => {
        const player =
          homeXI[index];

        if (!player) return;

        const converted =
          convertPosition(
            position,
            true
          );

        const object =
          createPlayer(
            player,
            converted.x,
            converted.z,
            new THREE.Color(
              homeColor
            ),
            'home',
            index
          );

        scene.add(object);

        homePlayersRef.current.push(
          object
        );
      }
    );

    // ----------------------------------------------------------
    // AWAY XI
    // ----------------------------------------------------------

    positions.forEach(
      (position, index) => {
        const player =
          awayXI[index];

        if (!player) return;

        const converted =
          convertPosition(
            position,
            false
          );

        const object =
          createPlayer(
            player,
            converted.x,
            converted.z,
            new THREE.Color(
              awayColor
            ),
            'away',
            index
          );

        scene.add(object);

        awayPlayersRef.current.push(
          object
        );
      }
    );

  }, [
    homeXI,
    awayXI,
    homeColor,
    awayColor,
    formation,
    getFormationPositions,
    convertPosition,
    createPlayer,
  ]);

  // ============================================================
  // RECEIVE MATCH ACTION
  // ============================================================

  useEffect(() => {
    if (!lastAction) return;

    actionRef.current =
      lastAction;

    actionStartRef.current =
      performance.now();

    // Move ball immediately to action start

    if (
      ballRef.current &&
      lastAction.from
    ) {
      ballRef.current.position.set(
        lastAction.from.x,
        0.18,
        lastAction.from.z
      );
    }
  }, [lastAction]);

  return (
    <div
      ref={mountRef}
      className="three-pitch"
      style={{
        width: '100%',
        height: '500px',
        overflow: 'hidden',
        borderRadius: '16px',
      }}
    />
  );
}
