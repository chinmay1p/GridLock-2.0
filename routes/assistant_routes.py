# [ignoring loop detection]
import json
import logging
from datetime import datetime
from flask import Blueprint, request, jsonify, make_response

from src.ai.recommendation_engine import analyze_incident

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

assistant_bp = Blueprint("assistant_routes", __name__)

# Cache for simulated plans & report data
REPORTS_CACHE = {}

@assistant_bp.route("/api/assistant/analyze", methods=["POST"])
def api_analyze_incident():
    """
    POST: Processes incident variables and runs the multi-stage AI decision support pipeline.
    """
    data = request.json or {}
    logger.info("AI Assistant analyzing incident: %s", data)

    event_type = data.get("event_type", "vehicle_breakdown")
    road_name = data.get("road_name", "Silk Board")
    duration_min = data.get("duration_min", 60)
    parameters = data.get("parameters", {})

    try:
        analysis = analyze_incident(event_type, road_name, duration_min, parameters)
        
        # Generate report ID and store in cache
        report_id = f"rpt_{int(datetime.now().timestamp())}"
        analysis["report_id"] = report_id
        
        # Build structured report using the backend builder
        from src.reports.report_builder import IncidentReportBuilder
        builder = IncidentReportBuilder(report_id, event_type, road_name, duration_min, analysis)
        report_data = builder.build_report()
        
        # Store both analysis and report data in cache
        analysis["report"] = report_data
        REPORTS_CACHE[report_id] = analysis

        return jsonify(analysis)
    except Exception as e:
        logger.error("Incident analysis failed: %s", e, exc_info=True)
        return jsonify({"error": str(e)}), 500


@assistant_bp.route("/api/assistant/generate-plan", methods=["POST"])
def api_generate_plan():
    """
    POST: Selects and prepares a detailed tactical intervention response plan (Plan A, B, or C).
    """
    data = request.json or {}
    plan_id = data.get("plan_id", "Plan B")
    report_id = data.get("report_id")

    analysis = None
    if report_id:
        analysis = REPORTS_CACHE.get(report_id)

    if not analysis:
        # Generate fresh analysis on the fly if not cached
        event_type = data.get("event_type", "vehicle_breakdown")
        road_name = data.get("road_name", "Silk Board")
        duration_min = data.get("duration_min", 60)
        parameters = data.get("parameters", {})
        analysis = analyze_incident(event_type, road_name, duration_min, parameters)

    plan_details = analysis["plans"].get(plan_id)
    if not plan_details:
        return jsonify({"error": f"Invalid plan identifier: {plan_id}"}), 400

    # Compile the final plan package
    plan_package = {
        "status": "success",
        "plan_id": plan_id,
        "plan_name": plan_details["name"],
        "clearance_time_min": plan_details["clearance_time_min"],
        "congestion_reduction_pct": plan_details["congestion_reduction_pct"],
        "complexity": plan_details["complexity"],
        "actions": plan_details["actions"],
        "recommendations": analysis["recommendations"]
    }

    return jsonify(plan_package)


@assistant_bp.route("/api/assistant/report/<report_id>", methods=["GET"])
def api_get_report(report_id):
    """
    GET: Compiles a formal Traffic Response Report and offers raw JSON or plain markdown format.
    """
    analysis = REPORTS_CACHE.get(report_id)
    if not analysis:
        return jsonify({"error": "Report ID not found in dashboard cache"}), 404

    format_type = request.args.get("format", "json")

    if format_type == "markdown":
        # Generate clean printable markdown report
        md = f"""# TRAFFIC TWIN BENGALURU — INCIDENT RESPONSE REPORT
Report ID: {report_id}
Incident Category: {analysis['event_type'].replace('_', ' ').title()}
Primary Corridor: {analysis['location_name']}
Target Clearance Window: {analysis['duration_min']} minutes
Severity Assessment: {analysis['severity']} (Score: {analysis['severity_score']}/100)

## 1. SITUATION SUMMARY
{analysis['summary']}

## 2. RISK ANALYSIS FACTORS
"""
        for factor in analysis['severity_factors']:
            md += f"- {factor}\n"

        md += f"""
- Closure risk probability estimate: {analysis['closure_probability_pct']}%

## 3. RECOMMENDED RESPONSE (Plan B)
- **Clearance Time Improvement:** {analysis['plans']['Plan B']['clearance_time_min']} mins (vs. {analysis['unmanaged_clearance_time_min']} mins unmanaged)
- **Average Segment Speed Target:** {analysis['plans']['Plan B']['avg_speed_kph']} km/h
- **Congestion Delay Reduction:** {analysis['expected_delay_reduction_pct']}%

### Tactical Deployments:
1. **Manpower:** {analysis['recommendations']['manpower']['description']}
2. **Diversion Route:** {analysis['recommendations']['diversion']['route']} ({analysis['recommendations']['diversion']['reason']})
3. **Signal Coordination:** {analysis['recommendations']['signal_strategy']['reason']}

## 4. SYSTEM EXPLANATIONS
"""
        for exp in analysis['explanations']:
            md += f"- {exp}\n"

        md += f"\n---\nReport compiled automatically by Bengaluru Digital Twin Command Assistant.\n"
        
        response = make_response(md)
        response.headers["Content-Disposition"] = f"attachment; filename=traffic_report_{report_id}.md"
        response.headers["Content-Type"] = "text/markdown"
        return response

    # Default to returning structured JSON
    return jsonify(analysis)
