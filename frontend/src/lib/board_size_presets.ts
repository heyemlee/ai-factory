export interface BoardSizePreset {
  width: number;
  height: number;
  thickness: number;
}

export const STANDARD_BOARD_HEIGHT = 2438.4;
export const STANDARD_THICKNESS = 18;

export const FREQUENT_BOARD_SIZES: BoardSizePreset[] = [
  { width: 303.8, height: STANDARD_BOARD_HEIGHT, thickness: STANDARD_THICKNESS },
  { width: 608.6, height: STANDARD_BOARD_HEIGHT, thickness: STANDARD_THICKNESS },
  { width: 285.8, height: STANDARD_BOARD_HEIGHT, thickness: STANDARD_THICKNESS },
  { width: 590.6, height: STANDARD_BOARD_HEIGHT, thickness: STANDARD_THICKNESS },
  { width: 264.8, height: STANDARD_BOARD_HEIGHT, thickness: STANDARD_THICKNESS },
  { width: 569.6, height: STANDARD_BOARD_HEIGHT, thickness: STANDARD_THICKNESS },
  { width: 762.0, height: STANDARD_BOARD_HEIGHT, thickness: STANDARD_THICKNESS },
  { width: 838.2, height: STANDARD_BOARD_HEIGHT, thickness: STANDARD_THICKNESS },
];

export function presetLabel(p: BoardSizePreset): string {
  return `${p.width} × ${p.height} × ${p.thickness} mm`;
}
