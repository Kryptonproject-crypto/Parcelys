#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Modèle analytique de performance et de consommation — architecture Aurora.

Ce script n'est pas un simulateur. C'est un modèle de premier ordre dont le
seul mérite est d'être *explicite* : chaque hypothèse est nommée, sourcée
quand elle vient d'une donnée publiée, et propagée jusqu'au résultat avec son
incertitude.

Usage :
    python3 aurora_model.py              # rapport complet
    python3 aurora_model.py --mc 20000   # Monte-Carlo avec N tirages

Aucune dépendance externe (bibliothèque standard uniquement).

Statut des chiffres produits : OBJECTIFS DE CONCEPTION, pas mesures.
Incertitude typique avant RTL : ±25 % sur l'IPC, ±30 % sur la puissance.
"""

from __future__ import annotations

import argparse
import math
import random
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# 1. HYPOTHÈSES DE PROCÉDÉ
# ---------------------------------------------------------------------------
# Source : TSMC. N2 vs N3E = +10-15 % perf à iso-puissance, -25-30 % puissance
# à iso-perf, +15 % densité (mixte). A16 vs N2P = +8-10 % vitesse,
# -15-20 % puissance, densité x1,10.
# https://www.tsmc.com/english/dedicatedFoundry/technology/logic/l_2nm
# https://www.tsmc.com/english/dedicatedFoundry/technology/logic/l_A16

PROCESS = {
    "N3E": {"perf": 1.00, "power": 1.00, "density": 1.00},
    "N2P": {"perf": 1.14, "power": 0.73, "density": 1.17},
    "A16": {"perf": 1.24, "power": 0.61, "density": 1.29},
}

# ---------------------------------------------------------------------------
# 2. MODÈLE DE PUISSANCE D'UN BLOC
# ---------------------------------------------------------------------------
# P_dyn  = C_eff * V^2 * f          (C_eff = capacité commutée effective)
# P_leak = L0 * (V / Vref) * exp((V - Vref) / S)
#
# C_eff est calibré par bloc à partir de la surface et de l'activité typique.
# S = 0,30 V est la pente sous-seuil effective retenue pour un GAA nanosheet
# à 70 °C (le FinFET se situait plutôt vers 0,25 V ; le GAA fuit moins).

V_REF = 1.00      # V, tension de référence pour la calibration de la fuite
LEAK_SLOPE = 0.30  # V


@dataclass
class Block:
    """Un bloc matériel caractérisé par sa capacité commutée et sa fuite."""
    name: str
    c_eff_nF: float        # capacité commutée effective, nanofarads
    leak_ref_W: float      # fuite à V_REF, 70 °C
    process: str = "N2P"

    def dynamic_W(self, volts: float, ghz: float, activity: float = 1.0) -> float:
        scale = PROCESS[self.process]["power"] / PROCESS["N2P"]["power"]
        return self.c_eff_nF * 1e-9 * volts**2 * ghz * 1e9 * activity * scale

    def leakage_W(self, volts: float) -> float:
        scale = PROCESS[self.process]["power"] / PROCESS["N2P"]["power"]
        return (self.leak_ref_W * (volts / V_REF)
                * math.exp((volts - V_REF) / LEAK_SLOPE) * scale)

    def power_W(self, volts: float, ghz: float, activity: float = 1.0) -> float:
        return self.dynamic_W(volts, ghz, activity) + self.leakage_W(volts)


# Calibration des blocs.
# C_eff est estimé à partir de la surface logique (doc. 2 §2.12) et d'une
# densité de capacité commutée de l'ordre de 0,5 nF/mm² sous activité SPEC,
# valeur extrapolée de dies publiés en 5/3 nm et mise à l'échelle vers N2P.

CORE_P = Block("Aurora-P", c_eff_nF=0.95, leak_ref_W=0.55)
CORE_E = Block("Aurora-E", c_eff_nF=0.34, leak_ref_W=0.16)
CORE_L = Block("Aurora-L", c_eff_nF=0.045, leak_ref_W=0.020)
GPU_SLICE = Block("Slice GPU", c_eff_nF=2.60, leak_ref_W=0.25)
MATRIX_UNIT = Block("Unité matricielle", c_eff_nF=1.35, leak_ref_W=0.10)

# Points de fonctionnement DVFS : (libellé, GHz, V)
DVFS_P = [("boost", 4.2, 1.00), ("nominal", 3.4, 0.82),
          ("efficace", 2.4, 0.68), ("minimal", 1.2, 0.60)]
DVFS_E = [("max", 2.8, 0.78), ("efficace", 1.2, 0.55), ("minimal", 0.6, 0.48)]
DVFS_G = [("boost", 2.2, 0.95), ("nominal", 1.8, 0.85), ("efficace", 1.2, 0.70)]


# ---------------------------------------------------------------------------
# 3. MODÈLE D'IPC DU CŒUR P
# ---------------------------------------------------------------------------
# Construction additive à partir d'un point de départ mesuré, avec un
# contributeur par décision d'architecture. Chaque contribution est donnée
# avec une fourchette : le point médian sert au rapport, les bornes servent au
# Monte-Carlo.
#
# Référence de départ : Tenstorrent TT-Ascalon, > 2,3 SPECint2017/GHz.
# https://tenstorrent.com/en/newsroom/tenstorrent-announces-availability-of-tt-ascalon

IPC_BASELINE = 2.30  # SPECint2017 par GHz

IPC_DELTAS = [
    # (libellé, gain min, gain médian, gain max)  — gains multiplicatifs
    ("Fetch découplé + prédicteur 3 niveaux (MPKI 4,0 -> 2,5)", 0.030, 0.055, 0.080),
    ("Fusion contractuelle 18-22 % (doc. 1 §1.7)",              0.040, 0.070, 0.095),
    ("Largeur 8 au lieu de 6",                                  0.030, 0.050, 0.075),
    ("ROB 512 + 384 registres physiques",                       0.020, 0.035, 0.055),
    ("3 chargements/cycle + store-set 4 K entrées",             0.020, 0.035, 0.050),
    ("Préchargement à précision contrôlée + Xaurdma",           0.025, 0.045, 0.070),
    ("SLC 3D : latence LLC 48 -> 35 cycles",                    0.020, 0.035, 0.055),
    ("Élimination au renommage (mv, idiomes zéro)",             0.010, 0.020, 0.030),
    ("Threads découplés Xaurdt (charges à pointeurs)",          0.005, 0.015, 0.030),
    # Contributions négatives : on les compte aussi.
    ("Files d'émission distribuées (perte d'optimalité)",      -0.025, -0.015, -0.008),
    ("Absence de cache d'µops (bulles de décodage résiduelles)", -0.020, -0.010, -0.004),
]

# Décote de recouvrement. Un modèle additif surestime systématiquement : les
# améliorations se recouvrent (un meilleur préchargement rend un plus grand
# ROB moins utile, etc.) et une première génération n'atteint jamais le
# rendement d'une microarchitecture mûrie sur trois itérations. La décote est
# appliquée explicitement plutôt que dissimulée dans des deltas pessimistes.
IPC_OVERLAP_DISCOUNT = (0.84, 0.90, 0.95)  # (min, médian, max)


def ipc_core_p(sample: bool = False) -> float:
    """IPC estimé du cœur P, en SPECint2017/GHz."""
    ipc = IPC_BASELINE
    for _label, lo, mid, hi in IPC_DELTAS:
        g = random.triangular(lo, hi, mid) if sample else mid
        ipc *= (1.0 + g)
    lo, mid, hi = IPC_OVERLAP_DISCOUNT
    ipc *= random.triangular(lo, hi, mid) if sample else mid
    return ipc


# Le cœur E vise un IPC de l'ordre de 62 % de celui du cœur P : moins large,
# prédicteur plus petit, fenêtre plus courte.
IPC_E_RATIO = 0.62
IPC_L_RATIO = 0.28


# ---------------------------------------------------------------------------
# 4. MODÈLE D'ÉNERGIE MÉMOIRE
# ---------------------------------------------------------------------------
# Énergies par accès de 64 octets, sauf indication. Ordres de grandeur issus
# de Horowitz (ISSCC) mis à l'échelle vers un nœud avancé, et des chiffres
# publiés sur le 3D V-Cache pour la liaison verticale.
# https://gwern.net/doc/cs/hardware/2014-horowitz-2.pdf

E_ACCESS_pJ = {
    "L1": 2.0,
    "tuile": 6.0,
    "L2": 20.0,
    "SLC": 60.0,
    "L4": 150.0,
    "LPDDR6": 1300.0,
    "HBM4": 900.0,
}

# Énergie de transport, en pJ par bit.
E_LINK_pJ_per_bit = {
    "hybrid_bonding": 0.05,   # AMD annonce < 1/3 de l'énergie des micro-bumps
    "ucie_avance": 0.25,
    "noc_saut": 0.08,
    "serdes_hors_package": 3.0,
}


def memory_energy_W(bandwidth_GBps: float, kind: str) -> float:
    """Puissance dissipée par un flux mémoire soutenu."""
    lines_per_s = bandwidth_GBps * 1e9 / 64.0
    return lines_per_s * E_ACCESS_pJ[kind] * 1e-12


def link_energy_W(bandwidth_GBps: float, kind: str) -> float:
    bits_per_s = bandwidth_GBps * 1e9 * 8.0
    return bits_per_s * E_LINK_pJ_per_bit[kind] * 1e-12


# ---------------------------------------------------------------------------
# 5. MODÈLE GPU
# ---------------------------------------------------------------------------
# Par Slice et par cycle : 512 FLOP FP32 (FMA compté 2), 2048 FP16,
# 16384 MXFP8, 32768 MXFP4 (doc. 3 §3.1).

FLOP_PER_SLICE_CYCLE = {"fp32": 1024, "fp16": 2048,
                        "mxfp8": 16384, "mxfp4": 32768}


def gpu_flops(slices: int, ghz: float, fmt: str) -> float:
    """FLOP/s crête."""
    return slices * FLOP_PER_SLICE_CYCLE[fmt] * ghz * 1e9


# Unité matricielle CPU : réseau 32x32 (doc. 2 §2.5).
MAC_PER_MATRIX_CYCLE = {"fp16": 1024, "mxfp8": 2048, "mxfp4": 4096}


def matrix_flops(units: int, ghz: float, fmt: str) -> float:
    return units * MAC_PER_MATRIX_CYCLE[fmt] * 2 * ghz * 1e9


# ---------------------------------------------------------------------------
# 6. CONFIGURATIONS PRODUIT
# ---------------------------------------------------------------------------

@dataclass
class Config:
    name: str
    p_cores: int
    e_cores: int
    l_cores: int
    gpu_slices: int
    matrix_units: int          # unités matricielles CPU
    slc_MB: int
    l4_MB: int
    mem_kind: str              # "LPDDR6" ou "HBM4"
    mem_bw_GBps: float
    process: str
    tdp_W: float
    # points de fonctionnement retenus pour le scénario nominal
    p_point: str = "nominal"
    e_point: str = "max"
    g_point: str = "nominal"
    # parts d'activité du scénario
    p_active: float = 1.0
    e_active: float = 1.0
    g_active: float = 1.0
    # Fraction du débit matriciel crête réellement soutenue dans le scénario.
    # C'est ce qui distingue une charge bureautique d'un entraînement.
    matrix_util: float = 0.02
    mem_util: float = 0.45
    io_W: float = 0.0
    display_W: float = 0.0
    notes: list[str] = field(default_factory=list)


CONFIGS = [
    Config("Aurora-M (mobile, 15 W)", p_cores=4, e_cores=8, l_cores=2,
           gpu_slices=2, matrix_units=2, slc_MB=32, l4_MB=0,
           mem_kind="LPDDR6", mem_bw_GBps=230, process="N2P", tdp_W=15,
           p_point="efficace", e_point="efficace", g_point="efficace",
           p_active=0.50, e_active=0.50, g_active=0.55,
           matrix_util=0.03, mem_util=0.22, io_W=1.1, display_W=2.1,
           notes=["scénario : bureautique mixte, navigateur, vidéo, "
                  "un peu d'inférence locale"]),

    Config("Aurora-D (desktop, 95 W)", p_cores=12, e_cores=16, l_cores=2,
           gpu_slices=8, matrix_units=6, slc_MB=64, l4_MB=0,
           mem_kind="LPDDR6", mem_bw_GBps=460, process="N2P", tdp_W=95,
           p_point="nominal", e_point="max", g_point="nominal",
           p_active=1.0, e_active=1.0, g_active=1.0,
           matrix_util=0.05, mem_util=0.42, io_W=3.8, display_W=0.0,
           notes=["scénario : compilation + rendu 3D simultanés, "
                  "CPU et GPU tous deux chargés"]),

    Config("Aurora-S (serveur/IA, 420 W)", p_cores=64, e_cores=32, l_cores=4,
           gpu_slices=16, matrix_units=32, slc_MB=256, l4_MB=1024,
           mem_kind="HBM4", mem_bw_GBps=8000, process="A16", tdp_W=420,
           p_point="nominal", e_point="max", g_point="nominal",
           p_active=0.35, e_active=0.50, g_active=0.25,
           matrix_util=0.55, mem_util=0.55, io_W=16.0, display_W=0.0,
           notes=["scénario : entraînement / inférence IA. Les cœurs CPU "
                  "alimentent les accélérateurs, ils ne font pas du SPEC."]),
]


def _point(table, label):
    for name, ghz, volts in table:
        if name == label:
            return ghz, volts
    raise KeyError(label)


def power_budget(cfg: Config) -> dict[str, float]:
    """Décomposition de la puissance pour la configuration donnée."""
    for blk in (CORE_P, CORE_E, CORE_L, GPU_SLICE, MATRIX_UNIT):
        blk.process = cfg.process

    p_ghz, p_v = _point(DVFS_P, cfg.p_point)
    e_ghz, e_v = _point(DVFS_E, cfg.e_point)
    g_ghz, g_v = _point(DVFS_G, cfg.g_point)

    out: dict[str, float] = {}
    out["cœurs P"] = cfg.p_cores * CORE_P.power_W(p_v, p_ghz, cfg.p_active)
    out["cœurs E"] = cfg.e_cores * CORE_E.power_W(e_v, e_ghz, cfg.e_active)
    out["cœurs L"] = cfg.l_cores * CORE_L.power_W(0.60, 1.0, 0.30)
    # GPU hors matrice : rastérisation, shading, texture, RT.
    out["GPU (hors matrice)"] = (cfg.gpu_slices
                                 * GPU_SLICE.power_W(g_v, g_ghz, cfg.g_active))
    # Unités matricielles : calculées par l'énergie/opération, pas par C_eff,
    # pour rester cohérent avec la section 5a. La fuite reste au modèle bloc.
    ops_peak = (gpu_flops(cfg.gpu_slices, g_ghz, "mxfp4")
                + matrix_flops(cfg.matrix_units, p_ghz, "mxfp4"))
    ops = ops_peak * cfg.matrix_util
    n_units = cfg.matrix_units + 2 * cfg.gpu_slices
    out["unités matricielles"] = (
        ops * E_MATRIX_OP_pJ["mxfp4"] * 1e-12
        + n_units * MATRIX_UNIT.leakage_W(p_v))

    # Trafic mémoire hors cœur.
    #
    # ATTENTION AU DOUBLE COMPTAGE : l'énergie des bancs de registres, des L1
    # et des L2 privés est déjà incluse dans C_eff des blocs de cœur. Seuls
    # les niveaux partagés (SLC, L4), le NoC, les liaisons verticales et la
    # DRAM sont comptés ici comme postes distincts.
    #
    # Hypothèse de hiérarchie : taux de succès SLC d'environ 70 %, donc le
    # trafic SLC vaut ~3,3x le trafic DRAM.
    dram_bw = cfg.mem_bw_GBps * cfg.mem_util
    slc_bw = dram_bw * 3.3

    out["DRAM + PHY"] = memory_energy_W(dram_bw, cfg.mem_kind)
    out["SLC"] = memory_energy_W(slc_bw, "SLC")
    out["L4"] = memory_energy_W(dram_bw * 1.5, "L4") if cfg.l4_MB else 0.0
    out["liaisons 3D"] = link_energy_W(slc_bw, "hybrid_bonding")
    out["NoC"] = link_energy_W(slc_bw * 1.4, "noc_saut")
    out["E/S"] = cfg.io_W
    out["affichage"] = cfg.display_W

    subtotal = sum(out.values())
    # Horloges globales, PLL, capteurs, régulation : ~6 % du sous-total.
    out["horloges, PLL, régulation"] = subtotal * 0.06
    return out


# Part de la puissance d'un cœur ou d'une Slice attribuable au déplacement de
# données *à l'intérieur* du bloc : bancs de registres, L1, L2, fils, réseaux
# d'opérandes. La littérature situe cette part entre 35 et 45 % sur les cœurs
# larges et les GPU. Elle est comptée séparément pour le diagnostic, sans être
# ajoutée au total (elle y est déjà, via C_eff).
IN_CORE_MOVEMENT_SHARE = 0.40


def data_movement_W(cfg: Config, budget: dict[str, float]) -> tuple[float, float]:
    """(déplacement hors cœur, déplacement intra-cœur estimé)."""
    off_core_keys = ["DRAM + PHY", "SLC", "L4", "liaisons 3D", "NoC"]
    off_core = sum(budget.get(k, 0.0) for k in off_core_keys)
    compute_keys = ["cœurs P", "cœurs E", "cœurs L", "GPU (hors matrice)",
                    "unités matricielles"]
    in_core = IN_CORE_MOVEMENT_SHARE * sum(budget.get(k, 0.0)
                                           for k in compute_keys)
    return off_core, in_core


# ---------------------------------------------------------------------------
# 7. EFFICACITÉ : COMPARAISONS
# ---------------------------------------------------------------------------
# Points de référence 2026, revendications publiques ramenées à une base
# commune. Ces valeurs servent de repère d'ordre de grandeur, pas de mesure
# comparative rigoureuse : les conditions de mesure diffèrent.

REFERENCES = {
    "IPC classe Apple (SPECint2017/GHz, estimation publique)": 3.0,
    "IPC TT-Ascalon (annoncé)": 2.3,
    "Fréquence Veyron V2 (annoncée)": 3.85,
    "NPU recherche MXFP4 (GOPS/W)": 4065.0,
    "NPU recherche MXINT8 (GOPS/W)": 657.0,
    "NPU mobile haut de gamme 2026 (TOPS INT8)": 50.0,
}


# Énergie par OPÉRATION dans une unité matricielle, au niveau système sur
# die : multiplieur, accumulateur, gestion du facteur d'échelle de bloc,
# livraison des opérandes depuis la SRAM de tuile, contrôle, horloge, part de
# fuite. Hors accès mémoire externe, comptés séparément.
#
# Calibration : le meilleur prototype de recherche publié annonce
# 4 065 GOPS/W en MXFP4, soit 0,246 pJ/op tout compris. Les valeurs ci-dessous
# visent 1,3 à 1,5x mieux, ce qui est ce qu'on peut défendre au titre du
# procédé plus avancé et de l'absence de NPU séparé — pas davantage.
E_MATRIX_OP_pJ = {"fp16": 0.98, "mxfp8": 0.34, "mxfp4": 0.155}

# Octets déplacés depuis la mémoire externe par opération, pour une GEMM de
# grande taille correctement tuilée. Le minimum théorique d'une GEMM 4096^3
# est ~2e-4 o/op ; on retient 8x ce minimum pour tenir compte du blocage réel.
BYTES_PER_OP_GEMM = 0.0016

UTILISATION_GEMM = 0.62  # rendement réel des unités sur GEMM de grande taille


def gemm_efficiency(cfg: Config, fmt: str = "mxfp4") -> dict[str, float]:
    """Efficacité en régime limité par le calcul (GEMM de grande taille)."""
    g_ghz, _ = _point(DVFS_G, cfg.g_point)
    p_ghz, _ = _point(DVFS_P, cfg.p_point)

    ops_peak = (gpu_flops(cfg.gpu_slices, g_ghz, fmt)
                + matrix_flops(cfg.matrix_units, p_ghz, fmt))
    ops = ops_peak * UTILISATION_GEMM

    p_compute = ops * E_MATRIX_OP_pJ[fmt] * 1e-12
    pJ_per_byte = E_ACCESS_pJ[cfg.mem_kind] / 64.0
    p_mem = ops * BYTES_PER_OP_GEMM * pJ_per_byte * 1e-12
    total = p_compute + p_mem

    return {
        "TOPS crête": ops_peak / 1e12,
        "TOPS soutenus": ops / 1e12,
        "puissance calcul (W)": p_compute,
        "puissance mémoire (W)": p_mem,
        "TOPS/W soutenus": ops / 1e12 / total,
    }


def decode_efficiency(cfg: Config, params_G: float = 7.0,
                      bytes_per_param: float = 0.5) -> dict[str, float]:
    """Régime limité par la bande passante : décodage autorégressif d'un LLM.

    À chaque token, tous les poids doivent être lus. C'est le cas où la
    hiérarchie mémoire décide de tout, pas les unités de calcul.
    """
    weights_B = params_G * 1e9 * bytes_per_param
    pJ_per_byte_mem = E_ACCESS_pJ[cfg.mem_kind] / 64.0
    pJ_per_byte_l4 = E_ACCESS_pJ["L4"] / 64.0
    pJ_per_byte_slc = E_ACCESS_pJ["SLC"] / 64.0
    # Traversée NoC + liaisons verticales pour remonter jusqu'aux unités.
    # 8 sauts de NoC en moyenne, puis une liaison verticale.
    noc_hops = 8
    pJ_per_byte_transit = 8.0 * (noc_hops * E_LINK_pJ_per_bit["noc_saut"]
                                 + E_LINK_pJ_per_bit["hybrid_bonding"])

    # (a) Naïf : tout depuis la mémoire externe, jusqu'aux unités de calcul.
    e_naif = weights_B * (pJ_per_byte_mem + pJ_per_byte_slc
                          + pJ_per_byte_transit) * 1e-12

    # (b) Avec étagement L4 : les poids sont amenés couche par couche en L4,
    #     puis servis depuis le L4 pour tout le lot.
    if cfg.l4_MB:
        e_l4 = weights_B * (pJ_per_byte_l4 + pJ_per_byte_transit) * 1e-12
    else:
        e_l4 = e_naif

    # (c) Avec GEMV près de la mémoire : les poids ne traversent ni le SLC,
    #     ni le NoC, ni les liaisons verticales.
    e_nm = weights_B * pJ_per_byte_mem * 1e-12

    # (d) Les deux : L4 et unités de proximité vivent tous deux sur le die de
    #     base. Les poids ne quittent jamais ce die. C'est le point de
    #     conception réel d'Aurora-S.
    e_both = weights_B * pJ_per_byte_l4 * 1e-12 if cfg.l4_MB else e_nm

    # Débit : limité par la bande passante disponible.
    tokens_s_mem = cfg.mem_bw_GBps * 1e9 / weights_B
    return {
        "poids (Go)": weights_B / 1e9,
        "J/token — naïf": e_naif,
        "J/token — étagement L4": e_l4,
        "J/token — near-memory": e_nm,
        "J/token — L4 + near-memory": e_both,
        "gain L4": e_naif / e_l4,
        "gain near-memory": e_naif / e_nm,
        "gain combiné": e_naif / e_both,
        "tokens/s (limite bande passante)": tokens_s_mem,
    }


# ---------------------------------------------------------------------------
# 8. MONTE-CARLO
# ---------------------------------------------------------------------------

def monte_carlo(n: int = 10000) -> dict[str, tuple[float, float, float]]:
    """Propage l'incertitude sur l'IPC, la fréquence et la puissance."""
    ipcs, freqs, specs, powers = [], [], [], []
    for _ in range(n):
        ipc = ipc_core_p(sample=True)
        # Fréquence : la cible est 4,2 GHz, avec un risque asymétrique à la
        # baisse (c'est ce qui rate le plus souvent, doc. 9 §9.8).
        f = random.triangular(3.5, 4.4, 4.2)
        # Puissance : incertitude de +/-30 % sur C_eff, asymétrique vers le haut.
        pw_scale = random.triangular(0.80, 1.40, 1.0)
        ipcs.append(ipc)
        freqs.append(f)
        specs.append(ipc * f)
        powers.append(CORE_P.power_W(1.00, f) * pw_scale)

    def stats(xs):
        xs = sorted(xs)
        return (xs[int(0.05 * len(xs))], xs[len(xs) // 2], xs[int(0.95 * len(xs))])

    return {
        "IPC (SPECint2017/GHz)": stats(ipcs),
        "Fréquence boost (GHz)": stats(freqs),
        "SPECint2017 mono-cœur": stats(specs),
        "Puissance cœur P en boost (W)": stats(powers),
    }


# ---------------------------------------------------------------------------
# 9. RAPPORT
# ---------------------------------------------------------------------------

def rule(title: str = "", width: int = 78) -> str:
    if not title:
        return "=" * width
    return f"\n{'=' * width}\n{title}\n{'=' * width}"


def report(mc_samples: int) -> None:
    print(rule("MODÈLE AURORA — objectifs de conception (pas des mesures)"))
    print("Incertitude avant RTL : environ +/-25 % sur l'IPC, +/-30 % sur la")
    print("puissance. Toutes les hypothèses sont dans le code source.")

    # --- IPC -------------------------------------------------------------
    print(rule("1. Construction de l'IPC du cœur P"))
    print(f"{'Contribution':<56}{'gain':>9}{'IPC cumulé':>13}")
    print("-" * 78)
    ipc = IPC_BASELINE
    print(f"{'Base : TT-Ascalon (annoncé)':<56}{'—':>9}{ipc:>13.3f}")
    for label, lo, mid, hi in IPC_DELTAS:
        ipc *= (1 + mid)
        print(f"{label:<56}{mid:>+8.1%}{ipc:>13.3f}")
    discount = IPC_OVERLAP_DISCOUNT[1]
    ipc *= discount
    print(f"{'Décote de recouvrement (1re génération)':<56}"
          f"{discount - 1:>+8.1%}{ipc:>13.3f}")
    print("-" * 78)
    assert abs(ipc - ipc_core_p()) < 1e-9, "table désynchronisée du modèle"
    print(f"{'IPC cible du cœur P (SPECint2017/GHz)':<56}{'':>9}{ipc:>13.2f}")
    print(f"{'IPC cœur E (62 %)':<56}{'':>9}{ipc * IPC_E_RATIO:>13.2f}")
    print(f"{'IPC cœur L (28 %)':<56}{'':>9}{ipc * IPC_L_RATIO:>13.2f}")

    f_boost = 4.2
    print(f"\nSPECint2017 mono-cœur estimé : {ipc * f_boost:.1f} "
          f"(à {f_boost} GHz)")

    # --- DVFS ------------------------------------------------------------
    print(rule("2. Points de fonctionnement et efficacité"))
    CORE_P.process = CORE_E.process = "N2P"
    ref_perf = ipc * f_boost
    ref_eff = ref_perf / CORE_P.power_W(1.00, f_boost)
    print("Référence des colonnes relatives : cœur P en boost = 100 %.")
    for blk, table, ipc_ratio in ((CORE_P, DVFS_P, 1.0),
                                  (CORE_E, DVFS_E, IPC_E_RATIO)):
        print(f"\n{blk.name} :")
        print(f"{'point':<12}{'GHz':>7}{'V':>7}{'P_dyn':>9}{'P_fuite':>10}"
              f"{'total':>9}{'perf rel.':>11}{'effic. rel.':>13}")
        for name, ghz, volts in table:
            pd = blk.dynamic_W(volts, ghz)
            pl = blk.leakage_W(volts)
            tot = pd + pl
            perf = ipc * ipc_ratio * ghz
            print(f"{name:<12}{ghz:>7.2f}{volts:>7.2f}{pd:>8.2f}W{pl:>9.2f}W"
                  f"{tot:>8.2f}W{perf / ref_perf:>10.0%}"
                  f"{(perf / tot) / ref_eff:>12.0%}")

    # Comparaison directe : que vaut la surface d'un cœur P remplie de cœurs E ?
    # Surfaces logiques de la doc. 2 §2.12.
    n_e = round(1.90 / 0.48)
    e_ghz, e_v = _point(DVFS_E, "max")
    e_tot = n_e * CORE_E.power_W(e_v, e_ghz)
    e_perf = n_e * ipc * IPC_E_RATIO * e_ghz
    print(f"\n{n_e} cœurs E (surface d'un cœur P) contre 1 cœur P en boost :")
    print(f"  débit    : {e_perf / ref_perf:>6.0%} de celui du cœur P")
    print(f"  puissance: {e_tot / CORE_P.power_W(1.00, f_boost):>6.0%}")
    print(f"  perf/W   : {(e_perf / e_tot) / ref_eff:>6.0%}")

    # --- Budgets de puissance -------------------------------------------
    print(rule("3. Budgets de puissance par configuration"))
    for cfg in CONFIGS:
        budget = power_budget(cfg)
        total = sum(budget.values())
        print(f"\n{cfg.name}  —  procédé {cfg.process}, "
              f"enveloppe visée {cfg.tdp_W} W")
        for note in cfg.notes:
            print(f"  ({note})")
        print("-" * 78)
        for k, v in sorted(budget.items(), key=lambda kv: -kv[1]):
            if v < 0.005:
                continue
            print(f"  {k:<40}{v:>9.2f} W{v / total:>10.1%}")
        print("-" * 78)
        print(f"  {'TOTAL modélisé':<40}{total:>9.2f} W")
        delta = (total - cfg.tdp_W) / cfg.tdp_W
        if delta > 0.05:
            verdict = "DÉPASSEMENT — à revoir"
        elif delta < -0.10:
            verdict = "marge disponible"
        else:
            verdict = "dans l'enveloppe"
        print(f"  {'écart à la cible':<40}{delta:>9.1%}   {verdict}")

        off_core, in_core = data_movement_W(cfg, budget)
        print(f"  {'déplacement hors cœur':<40}{off_core:>9.2f} W"
              f"{off_core / total:>10.1%}")
        print(f"  {'déplacement intra-cœur (estimé, déjà compté)':<40}"
              f"{in_core:>9.2f} W{in_core / total:>10.1%}")
        print(f"  {'>> déplacement total de données':<40}"
              f"{off_core + in_core:>9.2f} W"
              f"{(off_core + in_core) / total:>10.1%}")

    # --- Débit calcul ----------------------------------------------------
    print(rule("4. Débit de calcul"))
    for cfg in CONFIGS:
        g_ghz, _ = _point(DVFS_G, cfg.g_point)
        p_ghz, _ = _point(DVFS_P, cfg.p_point)
        print(f"\n{cfg.name}")
        print(f"  GPU FP32            : "
              f"{gpu_flops(cfg.gpu_slices, g_ghz, 'fp32') / 1e12:>8.2f} TFLOP/s")
        print(f"  GPU FP16            : "
              f"{gpu_flops(cfg.gpu_slices, g_ghz, 'fp16') / 1e12:>8.2f} TFLOP/s")
        print(f"  GPU MXFP4           : "
              f"{gpu_flops(cfg.gpu_slices, g_ghz, 'mxfp4') / 1e12:>8.2f} TFLOP/s")
        print(f"  Matrice CPU MXFP4   : "
              f"{matrix_flops(cfg.matrix_units, p_ghz, 'mxfp4') / 1e12:>8.2f} TFLOP/s")
        mt = ipc * p_ghz * (cfg.p_cores + cfg.e_cores * IPC_E_RATIO)
        print(f"  CPU agrégé (indice SPECint2017 cumulé, indicatif) : {mt:>8.0f}")

    # --- Efficacité matricielle -----------------------------------------
    print(rule("5a. Régime limité par le calcul (GEMM de grande taille)"))
    print(f"Repère publié (meilleur prototype de recherche) : "
          f"{REFERENCES['NPU recherche MXFP4 (GOPS/W)'] / 1000:.2f} TOPS/W "
          f"en MXFP4")
    print("Une cible très au-delà de ce repère ne serait pas défendable.\n")
    for cfg in CONFIGS:
        m = gemm_efficiency(cfg)
        print(f"{cfg.name}")
        for k, v in m.items():
            unit = (" TOPS/W" if "TOPS/W" in k
                    else " W" if "(W)" in k else " TOPS")
            print(f"  {k:<32}{v:>9.2f}{unit}")
        # Efficacité au niveau système : c'est le seul chiffre qu'un acheteur
        # constate réellement, puisqu'il paye la prise murale.
        sys_W = sum(power_budget(cfg).values())
        print(f"  {'TOPS/W au niveau système':<32}"
              f"{m['TOPS soutenus'] / sys_W:>9.2f} TOPS/W"
              f"   (sur {sys_W:.0f} W de SoC)")
        print()

    print(rule("5b. Régime limité par la mémoire (décodage LLM, 7 Md MXFP4)"))
    print("C'est ici que la hiérarchie mémoire décide de tout.\n")
    for cfg in CONFIGS:
        d = decode_efficiency(cfg)
        print(f"{cfg.name}")
        print(f"  {'poids à lire par token':<34}"
              f"{d['poids (Go)']:>9.2f} Go")
        print(f"  {'énergie/token — chemin naïf':<34}"
              f"{d['J/token — naïf'] * 1000:>9.2f} mJ")
        print(f"  {'énergie/token — étagement L4':<34}"
              f"{d['J/token — étagement L4'] * 1000:>9.2f} mJ"
              f"   (x{d['gain L4']:.1f})")
        print(f"  {'énergie/token — GEMV near-memory':<34}"
              f"{d['J/token — near-memory'] * 1000:>9.2f} mJ"
              f"   (x{d['gain near-memory']:.1f})")
        print(f"  {'énergie/token — L4 + near-memory':<34}"
              f"{d['J/token — L4 + near-memory'] * 1000:>9.2f} mJ"
              f"   (x{d['gain combiné']:.1f})")
        print(f"  {'débit plafond (bande passante)':<34}"
              f"{d['tokens/s (limite bande passante)']:>9.0f} tok/s")
        print()

    # --- Coût énergétique du déplacement --------------------------------
    print(rule("6. Ce que coûte un octet, selon d'où il vient"))
    print(f"{'niveau':<16}{'pJ / accès 64 o':>18}{'x vs L1':>12}"
          f"{'MAC équivalents':>20}")
    print("-" * 78)
    mac_pJ = 1.0
    for k, v in E_ACCESS_pJ.items():
        print(f"{k:<16}{v:>18.1f}{v / E_ACCESS_pJ['L1']:>11.0f}x"
              f"{v / mac_pJ:>20.0f}")

    # --- Monte-Carlo -----------------------------------------------------
    print(rule(f"7. Propagation d'incertitude ({mc_samples} tirages)"))
    print(f"{'grandeur':<40}{'p05':>12}{'médiane':>12}{'p95':>12}")
    print("-" * 78)
    for k, (lo, med, hi) in monte_carlo(mc_samples).items():
        print(f"{k:<40}{lo:>12.2f}{med:>12.2f}{hi:>12.2f}")

    print(rule("8. Falsifiabilité"))
    print("""Chaque cible ci-dessus est réfutable par une mesure précise :

  IPC              -> simulateur cycle-accurate calibré sur RTL (jalon M14).
                      Sous 2,6 SPECint2017/GHz, l'architecture est à revoir.
  Fréquence        -> navette MPW à M24. Sous 3,8 GHz, revoir le pipeline.
  Puissance        -> extraction post-layout + mesure sur MPW.
                      Au-delà de +30 %, revoir le mix de Vt et les marges.
  Traduction x86   -> prototype sur simulateur à M18.
                      Au-delà de 35 % de surcoût, renforcer Xaurx86.
  Efficacité IA    -> noyaux GEMM réels sur FPGA à M26.

Un objectif sans condition de réfutation n'est pas un objectif d'ingénierie.""")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mc", type=int, default=10000,
                        help="nombre de tirages Monte-Carlo")
    parser.add_argument("--seed", type=int, default=20260920)
    args = parser.parse_args()
    random.seed(args.seed)
    report(args.mc)


if __name__ == "__main__":
    main()
