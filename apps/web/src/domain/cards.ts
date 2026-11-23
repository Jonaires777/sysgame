// Cartas: cor + valor ("F7", "A+2", "TB", "VI") ou coringas "C" / "C+4".
import type { ColorCode } from "./protocol";

export const COLORS: ColorCode[] = ["F", "A", "T", "V"];

export const COLOR_NAMES: Record<ColorCode, string> = { F: "Fogo", A: "Água", T: "Terra", V: "Vento" };

export type CardKind = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface CardInfo {
  code: string;
  color: ColorCode | null; // null para coringas
  value: string;
  kind: CardKind;
  label: string; // texto curto do centro
  name: string; // descrição para acessibilidade
}

export const isWild = (code: string) => code === "C" || code === "C+4";

export function cardInfo(code: string): CardInfo {
  if (code === "C") return { code, color: null, value: "C", kind: "wild", label: "", name: "Coringa" };
  if (code === "C+4") return { code, color: null, value: "C+4", kind: "wild4", label: "+4", name: "Coringa +4" };
  const color = code[0] as ColorCode;
  const value = code.slice(1);
  const kind: CardKind = value === "B" ? "skip" : value === "I" ? "reverse" : value === "+2" ? "draw2" : "number";
  const valueName = { skip: "Bloqueio", reverse: "Inverte", draw2: "+2", number: value }[kind as Exclude<CardKind, "wild" | "wild4">];
  return { code, color, value, kind, label: kind === "number" || kind === "draw2" ? value : "", name: `${valueName} de ${COLOR_NAMES[color]}` };
}

/** Ordena a mão por cor e valor (coringas no fim). */
export function sortHand(cards: string[]): string[] {
  const order = (c: string) => (isWild(c) ? 9 : COLORS.indexOf(c[0] as ColorCode));
  return [...cards].sort((a, b) => order(a) - order(b) || a.localeCompare(b, "pt", { numeric: true }));
}
