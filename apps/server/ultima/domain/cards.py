"""Cartas do Última Carta.

Código de uma carta (string):
  cor + valor, onde cor ∈ F (Fogo), A (Água), T (Terra), V (Vento)
  e valor ∈ 0..9, "+2", "B" (Bloqueio), "I" (Inverte).  Ex.: "F7", "A+2", "TB", "VI".
  Coringas não têm cor: "C" (Coringa) e "C+4" (Coringa +4).
"""
from __future__ import annotations

import random

COLORS = ("F", "A", "T", "V")
COLOR_NAMES = {"F": "Fogo", "A": "Água", "T": "Terra", "V": "Vento"}
NUMBERS = tuple(str(n) for n in range(10))
ACTIONS = ("+2", "B", "I")
WILDS = ("C", "C+4")
VALUE_NAMES = {"+2": "+2", "B": "Bloqueio", "I": "Inverte", "C": "Coringa", "C+4": "Coringa +4"}


class CardError(ValueError):
    pass


def is_wild(card: str) -> bool:
    return card in WILDS


def color_of(card: str) -> str | None:
    return None if is_wild(card) else card[0]


def value_of(card: str) -> str:
    return card if is_wild(card) else card[1:]


def is_valid(card: str) -> bool:
    if card in WILDS:
        return True
    return len(card) >= 2 and card[0] in COLORS and card[1:] in NUMBERS + ACTIONS


def normalize(text: str) -> str:
    """Aceita variações digitadas pelo jogador ("f7", "c+4", "a +2") e devolve o código canônico."""
    card = text.strip().upper().replace(" ", "")
    if not is_valid(card):
        raise CardError(f"carta inválida: {text!r}")
    return card


def normalize_color(text: str) -> str:
    t = text.strip().upper()
    for code, name in COLOR_NAMES.items():
        if t in (code, name.upper(), name.upper().replace("Á", "A")):
            return code
    raise CardError(f"cor inválida: {text!r} (use F, A, T ou V)")


def describe(card: str) -> str:
    if is_wild(card):
        return VALUE_NAMES[card]
    v = value_of(card)
    return f"{VALUE_NAMES.get(v, v)} de {COLOR_NAMES[card[0]]}"


def new_deck(rng: random.Random | None = None) -> list[str]:
    """Baralho de 108 cartas: por cor, um 0 e dois de cada 1–9, +2, B e I; mais 4 C e 4 C+4."""
    deck: list[str] = []
    for c in COLORS:
        deck.append(c + "0")
        for v in NUMBERS[1:] + ACTIONS:
            deck += [c + v, c + v]
    deck += ["C"] * 4 + ["C+4"] * 4
    (rng or random.Random()).shuffle(deck)
    return deck
