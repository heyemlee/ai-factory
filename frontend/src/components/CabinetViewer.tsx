"use client";

import React, { useMemo, useState, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Edges } from "@react-three/drei";
import * as THREE from "three";
import { useLanguage } from "@/lib/i18n";

// Suppress THREE.Clock deprecation warning from react-three-fiber internals
if (typeof console !== 'undefined') {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('THREE.Clock')) return;
    originalWarn(...args);
  };
}

interface Part {
  part_id: string;
  Height: number;
  Width: number;
  cut_length: number;
  component: string;
  cab_id: string;
  cab_type: string;
}

interface Cabinet {
  cab_id: string;
  cab_type: string;
  parts: Part[];
  dimensions: { width: number; height: number; depth: number };
}

interface CabinetViewerProps {
  cabinet: Cabinet;
}

const THICKNESS = 18; // 18mm standard board thickness

// Material for the boards - standard transparent to avoid WebGL crashes with transmission
const boardMaterial = new THREE.MeshStandardMaterial({
  color: "#d4a373", // Warm wood/amber base color
  roughness: 0.3,
  metalness: 0.1,
  transparent: true,
  opacity: 0.85,
});

const highlightedMaterial = new THREE.MeshStandardMaterial({
  color: "#3b82f6", // Apple blue
  roughness: 0.2,
  metalness: 0.1,
  transparent: true,
  opacity: 0.9,
  emissive: "#1e3a8a",
  emissiveIntensity: 0.4,
});

function Board3D({ 
  part, 
  position, 
  args, 
  isHovered, 
  onHover 
}: { 
  part: Part; 
  position: [number, number, number]; 
  args: [number, number, number];
  isHovered: boolean;
  onHover: (hovered: boolean) => void;
}) {
  return (
    <mesh 
      position={position} 
      castShadow 
      receiveShadow
      onPointerOver={(e) => { e.stopPropagation(); onHover(true); }}
      onPointerOut={(e) => { e.stopPropagation(); onHover(false); }}
      material={isHovered ? highlightedMaterial : boardMaterial}
    >
      <boxGeometry args={args} />
      <Edges scale={1.001} threshold={15} color={isHovered ? "#60a5fa" : "#a87747"} />
    </mesh>
  );
}

export function Cabinet3DScene({ cabinet, hoveredPartId, setHoveredPartId }: { 
  cabinet: Cabinet;
  hoveredPartId: string | null;
  setHoveredPartId: (id: string | null) => void;
}) {
  const { width: cabW, height: cabH, depth: cabD } = cabinet.dimensions;

  // We map the parts to 3D positions based on heuristics
  const boards3D = useMemo(() => {
    const boards: any[] = [];
    
    // Group parts by component type to manage indices
    const grouped: Record<string, Part[]> = {
      side: [], top: [], bottom: [], back: [], shelf: [], stretcher: [], other: []
    };
    
    cabinet.parts.forEach(p => {
      const c = (p.component || "").toLowerCase();
      if (c.includes("side") || c.includes("侧板")) grouped.side.push(p);
      else if (c.includes("top") || c.includes("顶板")) grouped.top.push(p);
      else if (c.includes("bottom") || c.includes("底板")) grouped.bottom.push(p);
      else if (c.includes("back") || c.includes("背板")) grouped.back.push(p);
      else if (c.includes("shelf") || c.includes("层板")) grouped.shelf.push(p);
      else if (c.includes("stretcher") || c.includes("拉条")) grouped.stretcher.push(p);
      else grouped.other.push(p);
    });

    // We scale down the model so it fits nicely in the camera view
    // A standard cabinet is ~720x600x560. Let's scale by 0.01 (7.2 units)
    const SCALE = 0.01;
    const sW = cabW * SCALE;
    const sH = cabH * SCALE;
    const sD = cabD * SCALE;
    const sT = THICKNESS * SCALE;

    // Helper to add board
    const addBoard = (part: Part, px: number, py: number, pz: number, dx: number, dy: number, dz: number) => {
      boards.push({
        part,
        position: [px, py - sH/2, pz] as [number, number, number], // Offset so origin is centered vertically
        args: [dx, dy, dz] as [number, number, number]
      });
    };

    // Top
    grouped.top.forEach((p) => {
      addBoard(p, 0, sH - sT/2, 0, p.Height * SCALE, sT, p.Width * SCALE);
    });

    // Bottom
    grouped.bottom.forEach((p) => {
      addBoard(p, 0, sT/2, 0, p.Height * SCALE, sT, p.Width * SCALE);
    });

    // Sides (Left and Right): Height=柜高(Y), Width=柜深(Z)
    grouped.side.forEach((p, i) => {
      const isLeft = i % 2 === 0;
      const xPos = isLeft ? -sW/2 + sT/2 : sW/2 - sT/2;
      addBoard(p, xPos, sH/2, 0, sT, p.Height * SCALE, p.Width * SCALE);
    });

    // Back: Height=柜宽-30(X), Width=柜高(Y)
    grouped.back.forEach((p) => {
      addBoard(p, 0, sH/2, -sD/2 + sT/2, p.Height * SCALE, p.Width * SCALE, sT);
    });

    // Shelves
    const numShelves = grouped.shelf.length;
    grouped.shelf.forEach((p, i) => {
      const spacing = sH / (numShelves + 1);
      addBoard(p, 0, spacing * (i + 1), 0, p.Height * SCALE, sT, p.Width * SCALE);
    });

    // Stretchers (拉条): Height=柜宽-36(X), Width=101.6mm拉条深度(Z)
    // 地柜有2个拉条：一个在前边，一个在后边，都在柜体顶部
    grouped.stretcher.forEach((p, i) => {
      const pDepth = p.Width * SCALE; // 拉条深度 101.6mm
      const isFront = i % 2 === 0;
      const zPos = isFront ? sD/2 - pDepth/2 : -sD/2 + pDepth/2;
      addBoard(p, 0, sH - sT/2, zPos, p.Height * SCALE, sT, pDepth);
    });

    // Other (fallback for unrecognized parts)
    grouped.other.forEach((p) => {
      addBoard(p, 0, sH - sT*2, 0, p.Height * SCALE, sT, p.Width * SCALE);
    });

    return boards;
  }, [cabinet, cabW, cabH, cabD]);

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 20, 15]} intensity={1.2} castShadow />
      <directionalLight position={[-10, 10, -10]} intensity={0.6} />
      <hemisphereLight args={['#ffffff', '#444444', 0.5]} />
      
      <group>
        {boards3D.map((b, idx) => (
          <Board3D 
            key={`${b.part.part_id}-${idx}`} 
            part={b.part}
            position={b.position}
            args={b.args}
            isHovered={hoveredPartId === b.part.part_id}
            onHover={(h) => setHoveredPartId(h ? b.part.part_id : null)}
          />
        ))}
      </group>

      <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2 + 0.1} autoRotate={!hoveredPartId} autoRotateSpeed={1} />
    </>
  );
}

export default function CabinetCanvas({ cabinet, hoveredPartId, setHoveredPartId }: { 
  cabinet: Cabinet;
  hoveredPartId: string | null;
  setHoveredPartId: (id: string | null) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="w-full h-full relative cursor-grab active:cursor-grabbing bg-[#f8fafc] rounded-2xl overflow-hidden border border-black/5 shadow-inner">
      <Canvas camera={{ position: [12, 10, 15], fov: 45 }}>
        <Cabinet3DScene cabinet={cabinet} hoveredPartId={hoveredPartId} setHoveredPartId={setHoveredPartId} />
      </Canvas>
      <div className="absolute top-4 left-4 pointer-events-none">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/80 backdrop-blur rounded-lg border border-black/5 shadow-sm text-[12px] font-medium text-apple-gray">
          <span>{t("cabinet.dragRotate")}</span>
          <span className="w-1 h-1 rounded-full bg-apple-gray/30" />
          <span>{t("cabinet.scrollZoom")}</span>
        </div>
      </div>
    </div>
  );
}
