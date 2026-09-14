from flask import Flask, request, jsonify
from flask_cors import CORS

from match_engine import MatchManager

app = Flask(__name__)
CORS(app)

manager = MatchManager()


def ok(data):
    return jsonify({
        "success": True,
        "data": data
    })


def error(message, status=400):
    return jsonify({
        "success": False,
        "error": message
    }), status


@app.get("/")
def home():
    return jsonify({
        "success": True,
        "service": "Virtual Football Manager Python Engine",
        "status": "online"
    })


@app.post("/match/create")
def create_match():
    try:
        data = request.get_json(silent=True) or {}

        match_id = data.get("matchId")

        if not match_id:
            return error("matchId is required")

        snapshot = manager.create(data)

        return ok(snapshot)

    except Exception as exc:
        return error(str(exc), 500)


@app.get("/match/<match_id>")
def get_match(match_id):
    try:
        engine = manager.get(match_id)

        if engine is None:
            return error("Match not found", 404)

        engine.advance()

        return ok(engine.snapshot())

    except Exception as exc:
        return error(str(exc), 500)


@app.post("/match/<match_id>/start")
def start_match(match_id):
    try:
        engine = manager.get(match_id)

        if engine is None:
            return error("Match not found", 404)

        result = engine.start()

        return ok(result)

    except Exception as exc:
        return error(str(exc), 500)


@app.post("/match/<match_id>/pause")
def pause_match(match_id):
    try:
        engine = manager.get(match_id)

        if engine is None:
            return error("Match not found", 404)

        result = engine.pause()

        return ok(result)

    except Exception as exc:
        return error(str(exc), 500)


@app.post("/match/<match_id>/second-half")
def second_half(match_id):
    try:
        engine = manager.get(match_id)

        if engine is None:
            return error("Match not found", 404)

        result = engine.start_second_half()

        return ok(result)

    except Exception as exc:
        return error(str(exc), 500)


@app.post("/match/<match_id>/update")
def update_match(match_id):
    try:
        engine = manager.get(match_id)

        if engine is None:
            return error("Match not found", 404)

        engine.advance()

        return ok(engine.snapshot())

    except Exception as exc:
        return error(str(exc), 500)


@app.post("/match/<match_id>/tactics")
def change_tactics(match_id):
    try:
        engine = manager.get(match_id)

        if engine is None:
            return error("Match not found", 404)

        data = request.get_json(silent=True) or {}

        engine.set_tactics(
            data.get("side", "home"),
            data.get("tactics", {})
        )

        return ok(engine.snapshot())

    except Exception as exc:
        return error(str(exc), 500)


@app.post("/match/<match_id>/formation")
def change_formation(match_id):
    try:
        engine = manager.get(match_id)

        if engine is None:
            return error("Match not found", 404)

        data = request.get_json(silent=True) or {}

        engine.set_formation(
            data.get("side", "home"),
            data.get("formation", "4-4-2")
        )

        return ok(engine.snapshot())

    except Exception as exc:
        return error(str(exc), 500)


@app.post("/match/<match_id>/substitute")
def substitute(match_id):
    try:
        engine = manager.get(match_id)

        if engine is None:
            return error("Match not found", 404)

        data = request.get_json(silent=True) or {}

        result = engine.substitute(
            data.get("side", "home"),
            data.get("outgoingId"),
            data.get("incomingId")
        )

        return ok(result)

    except Exception as exc:
        return error(str(exc), 500)


@app.post("/match/<match_id>/finish")
def finish_match(match_id):
    try:
        engine = manager.get(match_id)

        if engine is None:
            return error("Match not found", 404)

        result = engine.finish()

        return ok(result)

    except Exception as exc:
        return error(str(exc), 500)


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False,
        threaded=True
    )
