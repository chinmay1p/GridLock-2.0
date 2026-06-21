"""
City Simulation Engine — Unified controller for the Bangalore Traffic Digital Twin.

Accepts a TrafficScenario and orchestrates the full prediction pipeline:

  STEP 1  Locate event        → nearest road finder → affected edge
  STEP 2  Event AI            → predict impact, duration, closure probability
  STEP 3  Modify traffic      → inject congestion shock into city state
  STEP 4  Run ST-GNN          → predict congestion at 15/30/60 min
  STEP 5  Closure simulation  → find alternative routes, affected roads
  STEP 6  Signal optimisation → recalculate optimal timings
  STEP 7  Recommendation      → generate police action plan + report

Returns a single JSON-serialisable dict containing every output.
"""
from __future__ import annotations

import json
import logging
import traceback
from pathlib import Path
from typing import Any, Dict, Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

BASE_DIR = Path(__file__).resolve().parents[2]
OUTPUT_DIR = BASE_DIR / "outputs"

# Local imports — each module is isolated and production-hardened
from src.simulation.scenario import TrafficScenario
from src.simulation.state_manager import get_city_state
from src.simulation.timeline_simulator import build_timeline
from src.simulation.impact_score import calculate_city_impact
from src.simulation.recommendation_engine import generate_recommendations
from src.simulation.report_generator import generate_report


class CitySimulationEngine:
    """
    Central orchestrator.  Stateless across calls — each ``run_simulation``
    resets the city state and runs the full pipeline fresh.
    """

    def __init__(self):
        self._state = get_city_state()

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------
    def run_simulation(self, scenario: TrafficScenario) -> Dict[str, Any]:
        """
        Execute the complete 7-step simulation pipeline.

        Args:
            scenario: A validated TrafficScenario object.

        Returns:
            Unified output dict with keys:
              scenario, event_prediction, affected_roads,
              future_congestion, recommended_diversion, signal_changes,
              city_impact, police_action_plan, timeline, report.
        """
        logging.info("=" * 60)
        logging.info("  CITY SIMULATION ENGINE — STARTING")
        logging.info("=" * 60)
        logging.info("Event: %s at %s", scenario.event_type, scenario.location_name)

        result: Dict[str, Any] = {"scenario": scenario.to_dict()}

        # Reset city state to baseline before each run
        self._state.reset_state()

        # ── STEP 1: Locate event → find affected edge ──────────────
        edge_id = self._step1_locate(scenario)
        scenario.edge_id = edge_id
        result["scenario"]["edge_id"] = edge_id
        logging.info("STEP 1 complete — affected edge: %s", edge_id)

        # ── STEP 2: Event AI → predict impact / duration / closure ──
        event_pred = self._step2_event_ai(scenario)
        result["event_prediction"] = event_pred
        logging.info("STEP 2 complete — impact: %s, duration: %s min",
                     event_pred.get("impact"), event_pred.get("expected_duration"))

        # ── STEP 3: Modify traffic state → inject shock ────────────
        self._step3_inject_shock(scenario, event_pred)
        logging.info("STEP 3 complete — congestion shock injected.")

        # ── STEP 4: Run ST-GNN → propagation timeline ─────────────
        gnn_timeline = self._step4_run_stgnn(scenario, event_pred)
        result["future_congestion"] = self._summarise_future(gnn_timeline, edge_id)
        logging.info("STEP 4 complete — GNN predicted %d edges.", len(gnn_timeline))

        # ── STEP 5: Closure simulation ────────────────────────────
        closure_report = self._step5_closure(scenario, event_pred)
        result["affected_roads"] = closure_report.get("affected_roads", []) if closure_report else []
        result["recommended_diversion"] = closure_report if closure_report else {}
        logging.info("STEP 5 complete — closure analysis done.")

        # ── STEP 6: Signal optimisation ───────────────────────────
        signal_report = self._step6_signals(scenario)
        result["signal_changes"] = signal_report if signal_report else {}
        logging.info("STEP 6 complete — signal optimisation done.")

        # ── City-wide impact score ─────────────────────────────────
        city_impact = calculate_city_impact(
            gnn_timeline=gnn_timeline,
            event_prediction=event_pred,
            total_roads=len(self._state.roads),
            closure_report=closure_report,
        )
        result["city_impact"] = city_impact
        result["impact"] = city_impact["impact_category"]

        # ── STEP 7: Recommendations + report ──────────────────────
        recs = generate_recommendations(
            scenario_dict=scenario.to_dict(),
            event_prediction=event_pred,
            closure_report=closure_report,
            signal_report=signal_report,
            city_impact=city_impact,
        )
        result["police_action_plan"] = recs

        # Timeline
        timeline = build_timeline(
            road_states=self._state.get_current_state(),
            gnn_timeline=gnn_timeline,
            event_edge_id=edge_id,
        )
        result["timeline"] = {
            "timestamps": timeline["timestamps"],
            "total_roads": len(timeline["snapshots"].get("T+0", [])),
        }

        # Natural language report
        report_text = generate_report(result)
        result["report"] = report_text

        # Persist full result
        OUTPUT_DIR.mkdir(exist_ok=True)
        with open(OUTPUT_DIR / "city_simulation_output.json", "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, default=str)

        logging.info("=" * 60)
        logging.info("  SIMULATION COMPLETE — Impact: %s", city_impact["impact_category"])
        logging.info("=" * 60)

        return result

    # ==================================================================
    # Pipeline steps (private)
    # ==================================================================

    def _step1_locate(self, scenario: TrafficScenario) -> str:
        """STEP 1: Find the nearest road edge to the event coordinates."""
        # If user already supplied an edge_id, use it directly
        if scenario.edge_id:
            return scenario.edge_id

        # Try lat/lng via OSMnx nearest-edge
        try:
            from src.graph_utils import get_nearest_edge
            result = get_nearest_edge(scenario.latitude, scenario.longitude)
            if result and result.get("edge_id"):
                return result["edge_id"]
        except Exception:
            logging.warning("OSMnx nearest-edge lookup failed; falling back to name search.")

        # Fallback: name-based search via the signal simulation helper
        if scenario.location_name:
            try:
                from src.signals.simulation import resolve_location_to_edge
                G = self._state.graph
                eid = resolve_location_to_edge(G, scenario.location_name)
                if eid:
                    return eid
            except Exception:
                pass

        # Ultimate fallback: pick first edge with highest flow
        best_eid = None
        best_flow = -1.0
        for eid, rd in self._state.roads.items():
            if rd["flow"] > best_flow:
                best_flow = rd["flow"]
                best_eid = eid
        if best_eid:
            logging.warning("Using highest-flow edge %s as fallback.", best_eid)
            return best_eid

        raise ValueError("Could not locate any road for the given scenario.")

    def _step2_event_ai(self, scenario: TrafficScenario) -> Dict[str, Any]:
        """STEP 2: Run the ML event-impact model."""
        try:
            from src.models.predict import predict_event_effect
            features = scenario.convert_to_model_features()
            return predict_event_effect(features)
        except Exception as e:
            logging.error("Event prediction failed: %s", e)
            return {
                "impact": "MEDIUM",
                "impact_score": 0.5,
                "closure_probability": 0.3,
                "expected_duration": 45,
                "duration": "45 minutes",
                "affected_radius": "1.5km",
            }

    def _step3_inject_shock(self, scenario: TrafficScenario, event_pred: Dict[str, Any]) -> None:
        """STEP 3: Inject the event impact into the city state."""
        impact_score = event_pred.get("impact_score", 0.5)
        self._state.apply_event(
            event={"type": scenario.event_type, "impact_score": impact_score},
            affected_edge_id=scenario.edge_id,
        )

    def _step4_run_stgnn(self, scenario: TrafficScenario, event_pred: Dict[str, Any]) -> list:
        """STEP 4: Run the ST-GNN congestion propagation model."""
        try:
            from src.simulator.scenario_engine import get_base_graph
            from src.simulator.impact_analyzer import run_gnn_propagation

            G = get_base_graph()
            impact_score = event_pred.get("impact_score", 0.5)
            return run_gnn_propagation(G, scenario.edge_id, impact_score)
        except Exception as e:
            logging.error("ST-GNN propagation failed: %s", e)
            traceback.print_exc()
            return []

    def _step5_closure(self, scenario: TrafficScenario, event_pred: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """STEP 5: Run closure simulation if applicable."""
        closure_prob = event_pred.get("closure_probability", 0.0)
        has_closure = scenario.road_action.closure or closure_prob > 0.4

        if not has_closure:
            logging.info("STEP 5: No closure indicated (prob %.2f); skipping.", closure_prob)
            return None

        try:
            from src.simulator.scenario_engine import simulate_scenario
            config = {
                "edge_id": scenario.edge_id,
                "type": scenario.road_action.closure_type if scenario.road_action.closure else "partial",
                "closure_percentage": scenario.road_action.percentage if scenario.road_action.closure else 50.0,
            }
            return simulate_scenario(config)
        except Exception as e:
            logging.error("Closure simulation failed: %s", e)
            traceback.print_exc()
            return None

    def _step6_signals(self, scenario: TrafficScenario) -> Optional[Dict[str, Any]]:
        """STEP 6: Run adaptive signal optimisation."""
        try:
            from src.signals.simulation import optimize_after_event
            event_dict = {
                "accident_location": scenario.location_name or scenario.edge_id,
                "type": scenario.road_action.closure_type if scenario.road_action.closure else "full",
                "closure_percentage": scenario.road_action.percentage,
            }
            return optimize_after_event(event_dict)
        except Exception as e:
            logging.error("Signal optimisation failed: %s", e)
            traceback.print_exc()
            return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _summarise_future(gnn_timeline: list, edge_id: str) -> Dict[str, Any]:
        """Extract the epicenter edge's congestion forecast from GNN output."""
        for row in gnn_timeline:
            if row.get("edge_id") == edge_id:
                return {
                    "current": row.get("current", 0.0),
                    "T+15": row.get("15min", 0.0),
                    "T+30": row.get("30min", 0.0),
                    "T+60": row.get("60min", 0.0),
                }
        return {"current": 0.0, "T+15": 0.0, "T+30": 0.0, "T+60": 0.0}
