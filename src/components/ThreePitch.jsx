// components/ThreePitch.jsx

import {
  useEffect,
  useRef,
  useCallback,
} from 'react';

import * as THREE from 'three';

import { OrbitControls } from
  'three/examples/jsm/controls/OrbitControls';

import {
  FORMATIONS,
  normalizePosition,
  getPlayerId,
  getPlayerName,
} from './MatchEngine';

export default function ThreePitch({
  homeXI = [],
  awayXI = [],
  homeColor = '#2563eb',
  awayColor = '#dc2626',
  formation = '4-4-2',

  matchStarted = false,
  ballTeam = null,
  activePlayerId = null,
  action = null,
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
    useRef([]);

  const awayPlayersRef =
    useRef([]);

  const ballRef =
    useRef(null);

  const animationRef =
    useRef(null);

  const targetRef =
    useRef({
      x: 0,
      z: 0,
    });

  /*
   * Formation coordinates.
   */
  const getPositions =
    useCallback(
      (formationName, team) => {

        const formationData =
          FORMATIONS[
            formationName
          ] ||
          FORMATIONS['4-4-2'];

        return formationData.map(
          (slot, index) => {

            let x =
              ((slot.x - 50) / 50) *
              13;

            let z =
              ((slot.y - 50) / 50) *
              8;

            /*
             * Away team is mirrored.
             */
            if (team === 'away') {
              x = -x;
              z = -z;
            }

            return {
              x,
              z,
              role: slot.role,
              index,
            };
          }
        );
      },
      []
    );

  /*
   * Create 3D scene.
   */
  useEffect(() => {

    if (!mountRef.current) {
      return;
    }

    const mount =
      mountRef.current;

    const width =
      mount.clientWidth || 800;

    const height =
      mount.clientHeight || 500;

    const scene =
      new THREE.Scene();

    scene.background =
      new THREE.Color(
        0x08111f
      );

    sceneRef.current =
      scene;

    /*
     * CAMERA
     */
    const camera =
      new THREE.PerspectiveCamera(
        42,
        width / height,
        0.1,
        200
      );

    camera.position.set(
      0,
      24,
      30
    );

    camera.lookAt(
      0,
      0,
      0
    );

    cameraRef.current =
      camera;

    /*
     * RENDERER
     */
    const renderer =
      new THREE.WebGLRenderer({
        antialias: true,
      });

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        2
      )
    );

    renderer.setSize(
      width,
      height
    );

    renderer.shadowMap.enabled =
      true;

    mount.appendChild(
      renderer.domElement
    );

    rendererRef.current =
      renderer;

    /*
     * CONTROLS
     */
    const controls =
      new OrbitControls(
        camera,
        renderer.domElement
      );

    controls.enableDamping =
      true;

    controls.dampingFactor =
      0.06;

    controls.minDistance =
      15;

    controls.maxDistance =
      42;

    controls.maxPolarAngle =
      Math.PI / 2.35;

    controls.target.set(
      0,
      0,
      0
    );

    controls.update();

    controlsRef.current =
      controls;

    /*
     * LIGHTING
     */
    const ambient =
      new THREE.AmbientLight(
        0xffffff,
        0.75
      );

    scene.add(
      ambient
    );

    const light =
      new THREE.DirectionalLight(
        0xffffff,
        1.4
      );

    light.position.set(
      8,
      20,
      10
    );

    light.castShadow =
      true;

    scene.add(
      light
    );

    /*
     * PITCH
     */
    const pitch =
      new THREE.Mesh(
        new THREE.PlaneGeometry(
          30,
          20
        ),
        new THREE.MeshStandardMaterial({
          color: 0x176b35,
          roughness: 0.85,
        })
      );

    pitch.rotation.x =
      -Math.PI / 2;

    pitch.receiveShadow =
      true;

    scene.add(
      pitch
    );

    /*
     * PITCH LINES
     */
    const lineMaterial =
      new THREE.LineBasicMaterial({
        color: 0xffffff,
      });

    function addLine(points) {

      const geometry =
        new THREE.BufferGeometry()
          .setFromPoints(
            points
          );

      scene.add(
        new THREE.Line(
          geometry,
          lineMaterial
        )
      );
    }

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

    /*
     * CENTER CIRCLE
     */
    const circle =
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

    circle.rotation.x =
      -Math.PI / 2;

    circle.position.y =
      0.04;

    scene.add(
      circle
    );

    /*
     * PENALTY BOXES
     */
    function createBox(
      x,
      width,
      depth
    ) {

      const geometry =
        new THREE.EdgesGeometry(
          new THREE.BoxGeometry(
            width,
            0.02,
            depth
          )
        );

      const line =
        new THREE.LineSegments(
          geometry,
          lineMaterial
        );

      line.position.set(
        x,
        0.04,
        0
      );

      scene.add(line);
    }

    createBox(
      -12,
      6,
      12
    );

    createBox(
      12,
      6,
      12
    );

    /*
     * GOALS
     */
    const goalMaterial =
      new THREE.MeshStandardMaterial({
        color: 0xe5e7eb,
      });

    [-15, 15].forEach(
      x => {

        const goal =
          new THREE.Mesh(
            new THREE.BoxGeometry(
              0.3,
              1.5,
              6
            ),
            goalMaterial
          );

        goal.position.set(
          x,
          0.75,
          0
        );

        scene.add(
          goal
        );
      }
    );

    /*
     * BALL
     */
    const ball =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.22,
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
      0.22,
      0
    );

    ball.castShadow =
      true;

    scene.add(
      ball
    );

    ballRef.current =
      ball;

    /*
     * ANIMATION LOOP
     */
    let running = true;

    function animate() {

      if (!running) {
        return;
      }

      animationRef.current =
        requestAnimationFrame(
          animate
        );

      /*
       * Move ball smoothly.
       */
      if (ballRef.current) {

        const dx =
          targetRef.current.x -
          ballRef.current.position.x;

        const dz =
          targetRef.current.z -
          ballRef.current.position.z;

        ballRef.current.position.x +=
          dx * 0.08;

        ballRef.current.position.z +=
          dz * 0.08;

        ballRef.current.position.y =
          0.22 +
          Math.abs(
            Math.sin(
              Date.now() * 0.01
            )
          ) * 0.03;
      }

      /*
       * Move players toward targets.
       */
      [
        ...homePlayersRef.current,
        ...awayPlayersRef.current,
      ].forEach(
        item => {

          if (!item?.group) {
            return;
          }

          const group =
            item.group;

          const target =
            item.target;

          if (!target) {
            return;
          }

          const dx =
            target.x -
            group.position.x;

          const dz =
            target.z -
            group.position.z;

          const distance =
            Math.sqrt(
              dx * dx +
              dz * dz
            );

          if (distance > 0.03) {

            const speed =
              0.025;

            group.position.x +=
              (dx / distance) *
              Math.min(
                speed,
                distance
              );

            group.position.z +=
              (dz / distance) *
              Math.min(
                speed,
                distance
              );

            group.rotation.y =
              Math.atan2(
                dx,
                dz
              );
          }
        }
      );

      controls.update();

      renderer.render(
        scene,
        camera
      );
    }

    animate();

    /*
     * RESIZE
     */
    function resize() {

      if (!mountRef.current) {
        return;
      }

      const w =
        mountRef.current.clientWidth ||
        800;

      const h =
        mountRef.current.clientHeight ||
        500;

      camera.aspect =
        w / h;

      camera.updateProjectionMatrix();

      renderer.setSize(
        w,
        h
      );
    }

    window.addEventListener(
      'resize',
      resize
    );

    /*
     * CLEANUP
     */
    return () => {

      running = false;

      if (
        animationRef.current
      ) {
        cancelAnimationFrame(
          animationRef.current
        );
      }

      window.removeEventListener(
        'resize',
        resize
      );

      controls.dispose();

      renderer.dispose();

      scene.traverse(
        object => {

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
                material =>
                  material.dispose()
              );

            } else {

              object.material.dispose();

            }
          }
        }
      );

      if (
        renderer.domElement.parentNode ===
        mount
      ) {
        mount.removeChild(
          renderer.domElement
        );
      }

      scene.clear();

    };

  }, []);

  /*
   * Create players.
   */
  useEffect(() => {

    const scene =
      sceneRef.current;

    if (!scene) {
      return;
    }

    /*
     * Remove old players.
     */
    [
      ...homePlayersRef.current,
      ...awayPlayersRef.current,
    ].forEach(
      item => {

        if (item?.group) {
          scene.remove(
            item.group
          );
        }
      }
    );

    homePlayersRef.current =
      [];

    awayPlayersRef.current =
      [];

    function createPlayer(
      player,
      position,
      color,
      team
    ) {

      const group =
        new THREE.Group();

      /*
       * BODY
       */
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
        0.33;

      body.castShadow =
        true;

      group.add(
        body
      );

      /*
       * HEAD
       */
      const head =
        new THREE.Mesh(
          new THREE.SphereGeometry(
            0.17,
            16,
            16
          ),
          new THREE.MeshStandardMaterial({
            color: 0xf0b48b,
          })
        );

      head.position.y =
        0.78;

      head.castShadow =
        true;

      group.add(
        head
      );

      /*
       * Player number/name marker.
       */
      group.userData = {
        player,
        team,
      };

      group.position.set(
        position.x,
        0,
        position.z
      );

      scene.add(
        group
      );

      return {
        group,
        player,
        target: {
          x: position.x,
          z: position.z,
        },
        base: {
          x: position.x,
          z: position.z,
        },
        team,
      };
    }

    const homePositions =
      getPositions(
        formation,
        'home'
      );

    const awayPositions =
      getPositions(
        formation,
        'away'
      );

    homeXI
      .slice(0, 11)
      .forEach(
        (player, index) => {

          const position =
            homePositions[
              index
            ];

          if (!position) {
            return;
          }

          homePlayersRef.current.push(
            createPlayer(
              player,
              position,
              homeColor,
              'home'
            )
          );
        }
      );

    awayXI
      .slice(0, 11)
      .forEach(
        (player, index) => {

          const position =
            awayPositions[
              index
            ];

          if (!position) {
            return;
          }

          awayPlayersRef.current.push(
            createPlayer(
              player,
              position,
              awayColor,
              'away'
            )
          );
        }
      );

  }, [
    homeXI,
    awayXI,
    homeColor,
    awayColor,
    formation,
    getPositions,
  ]);

  /*
   * REAL-TIME MOVEMENT.
   */
  useEffect(() => {

    if (
      !matchStarted
    ) {
      return;
    }

    const allPlayers = [
      ...homePlayersRef.current,
      ...awayPlayersRef.current,
    ];

    /*
     * Small positional movement around
     * tactical positions.
     */
    allPlayers.forEach(
      item => {

        if (!item?.base) {
          return;
        }

        const isActive =
          getPlayerId(
            item.player
          ) ===
          String(
            activePlayerId || ''
          );

        let x =
          item.base.x;

        let z =
          item.base.z;

        /*
         * Active player moves toward ball.
         */
        if (
          isActive &&
          ballRef.current
        ) {

          const ball =
            ballRef.current.position;

          x =
            ball.x +
            (
              item.team === 'home'
                ? 1.0
                : -1.0
            );

          z =
            ball.z;
        }

        /*
         * Team in possession pushes forward.
         */
        else if (
          item.team === ballTeam
        ) {

          x +=
            item.team === 'home'
              ? 1.2
              : -1.2;

          z +=
            (
              Math.random() -
              0.5
            ) * 1.5;
        }

        /*
         * Players return toward formation.
         */
        item.target = {
          x: Math.max(
            -14,
            Math.min(
              14,
              x
            )
          ),

          z: Math.max(
            -9,
            Math.min(
              9,
              z
            )
          ),
        };
      }
    );

    /*
     * Ball movement.
     */
    if (
      ballRef.current
    ) {

      const teamPlayers =
        ballTeam === 'home'
          ? homePlayersRef.current
          : awayPlayersRef.current;

      if (
        teamPlayers.length
      ) {

        const active =
          teamPlayers.find(
            item =>
              getPlayerId(
                item.player
              ) ===
              String(
                activePlayerId || ''
              )
          ) ||
          teamPlayers[
            Math.floor(
              Math.random() *
              teamPlayers.length
            )
          ];

        if (active) {

          let tx =
            active.group
              .position.x;

          let tz =
            active.group
              .position.z;

          /*
           * Different action types.
           */
          if (
            action === 'pass'
          ) {

            tx +=
              ballTeam === 'home'
                ? 3
                : -3;

          } else if (
            action === 'attack'
          ) {

            tx +=
              ballTeam === 'home'
                ? 5
                : -5;

          } else if (
            action === 'shot' ||
            action === 'goal'
          ) {

            tx =
              ballTeam === 'home'
                ? 14
                : -14;

          } else {

            tx +=
              (
                Math.random() -
                0.5
              ) * 3;

          }

          tz +=
            (
              Math.random() -
              0.5
            ) * 4;

          targetRef.current = {
            x: Math.max(
              -14,
              Math.min(
                14,
                tx
              )
            ),

            z: Math.max(
              -9,
              Math.min(
                9,
                tz
              )
            ),
          };
        }
      }
    }

  }, [
    matchStarted,
    ballTeam,
    activePlayerId,
    action,
  ]);

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: '500px',
        minHeight: '500px',
        overflow: 'hidden',
        borderRadius: '18px',
      }}
    />
  );
}
