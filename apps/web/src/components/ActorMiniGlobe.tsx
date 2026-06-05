"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const R = 1.6;

function latLngToVec3(lat: number, lng: number, r = R): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

export function ActorMiniGlobe({
  lat,
  lng,
  label,
}: {
  lat: number;
  lng: number;
  label: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 50);
    camera.position.set(0, 0, 4.2);

    const group = new THREE.Group();
    scene.add(group);

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(5, 2, 5);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(R, 48, 48),
      new THREE.MeshStandardMaterial({
        color: 0x0b1220,
        roughness: 0.9,
        metalness: 0.05,
        emissive: 0x05070c,
        emissiveIntensity: 0.6,
      })
    );
    group.add(globe);

    const atmos = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.02, 48, 48),
      new THREE.MeshBasicMaterial({
        color: 0x0ea5e9,
        transparent: true,
        opacity: 0.08,
        side: THREE.BackSide,
        depthWrite: false,
      })
    );
    group.add(atmos);

    const markerPos = latLngToVec3(lat, lng, R * 1.01);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x22c55e })
    );
    marker.position.copy(markerPos);
    group.add(marker);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.085, 32),
      new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.position.copy(markerPos.clone().multiplyScalar(1.001));
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    group.add(ring);

    const onResize = () => {
      if (!el) return;
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      group.rotation.y += 0.003;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", onResize);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh.material ?? null) as THREE.Material | THREE.Material[] | null;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [lat, lng]);

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="absolute inset-0" />
      <div className="absolute left-3 bottom-3 text-xs text-zinc-200 bg-zinc-950/70 border border-zinc-800 px-2 py-1 rounded tabular-nums tracking-wide">
        {label}
      </div>
    </div>
  );
}
