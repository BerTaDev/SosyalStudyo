import datetime as dt
from pathlib import Path

import core

MODELS = [("claude-fable-5-1", "Fable 5.1", "En güçlü, en pahalı; limiti en hızlı tüketir"),
          ("claude-opus-5-5", "Opus 5.5", "Çok güçlü; zor tasarım ve animasyon işleri"),
          ("claude-sonnet-5-5", "Sonnet 5.5", "Dengeli; çoğu video ve metin işi için yeterli"),
          ("claude-haiku-5-5", "Haiku 5.5", "Hızlı ve ucuz; açıklama, kısa metin")]
EFFORTS = [("low", "Düşük"), ("medium", "Orta"), ("high", "Yüksek"), ("xhigh", "Çok yüksek"), ("max", "En yüksek")]
STALE = 20 * 60


def path():
    return core.HOME / "claude.json"


def load():
    d = core.read_json(path(), None) or {}
    d.setdefault("usage", None)
    d.setdefault("updated", None)
    d.setdefault("sessions", {})
    d.setdefault("manager", None)
    d.setdefault("refresh", None)
    return d


def prefs():
    p = core.settings().get("claude") or {}
    return {"model": p.get("model") or "", "effort": p.get("effort") or ""}


def report(agent, plan=None, session=None, manager=False, account="main"):
    with core.locked():
        d = load()
        if plan:
            d.setdefault("usage_by", {})[account] = {"usage": plan, "updated": core.now()}
            if account == "main":
                d["usage"] = plan
                d["updated"] = core.now()
                d["refresh"] = None
        if session and agent:
            info = {k: session.get(k) for k in ("sessionId", "model", "effort")}
            info["updated"] = core.now()
            info["account"] = account
            if manager:
                d["manager"] = dict(info, name=agent, seen=core.now())
            else:
                d["sessions"][agent] = info
        elif manager and agent:
            d["manager"] = dict(d.get("manager") or {}, name=agent, seen=core.now())
        core.write_json(path(), d)
        return d


def manager_seen(agent):
    with core.locked():
        d = load()
        d["manager"] = dict(d.get("manager") or {}, name=agent, seen=core.now())
        core.write_json(path(), d)


def request_refresh():
    with core.locked():
        d = load()
        d["refresh"] = core.now()
        core.write_json(path(), d)


def pending_changes():
    want = prefs()
    out = []
    agents = {a["name"]: a for a in core.list_agents()}
    for name, s in load()["sessions"].items():
        if name not in agents or not s.get("sessionId") or (s.get("account") or "main") != "main":
            continue
        change = {}
        if want["model"] and s.get("model") != want["model"]:
            change["model"] = want["model"]
        if want["effort"] and s.get("effort") != want["effort"]:
            change["effort"] = want["effort"]
        if change:
            out.append(dict(change, agent=name, session_id=s["sessionId"]))
    return out


def _age(iso):
    return (dt.datetime.now() - core.parse_time(iso)).total_seconds() if iso else None


def accounts():
    import accounts as accmod
    acc = core.active_accounts()
    agents = core.list_agents()
    d = load()
    mgr = (d.get("manager") or {}).get("name")
    out = []
    for a in accmod.all_accounts():
        k = a["id"]
        mine = [x for x in agents if (x.get("account") or "main") == k and x["live"] != "off" and x["name"] != mgr]
        lp = accmod.launcher(a)
        usage, updated = usage_for(d, k)
        out.append({"id": k, "name": a["name"], "active": k in acc, "dir": a.get("dir"), "launcher": bool(lp and lp.exists()),
                    "usage": usage, "updated": updated,
                    "agents": [{"name": x["name"], "live": x["live"], "only": x.get("only") or [], "text": x.get("text") or ""} for x in mine]})
    return out


def usage_for(d, account):
    if account == "main":
        return d["usage"], d["updated"]
    u = (d.get("usage_by") or {}).get(account) or {}
    return u.get("usage"), u.get("updated")


def state():
    d = load()
    m = d.get("manager") or {}
    age = _age(m.get("seen"))
    agents = {a["name"]: a for a in core.list_agents()}
    sessions = [dict(s, name=n, live=agents.get(n, {}).get("live", "off"), account=agents.get(n, {}).get("account") or s.get("account") or "main")
                for n, s in d["sessions"].items() if n in agents]
    acc = core.active_account()
    usage, updated = usage_for(d, acc)
    return {"account": acc, "active_accounts": core.active_accounts(), "accounts": accounts(), "studio_dir": str(Path(__file__).resolve().parent), "cli": core.cli(),
            "agent_names": [a["name"] for a in core.list_agents()],
            "usage": usage, "updated": updated, "stale": _age(updated) is None or _age(updated) > STALE,
            "manager": dict(m, live=age is not None and age < 90) if m else None, "refresh": d["refresh"],
            "sessions": sessions, "prefs": prefs(), "pending": pending_changes(),
            "models": [{"id": i, "name": n, "note": t} for i, n, t in MODELS], "efforts": [{"id": i, "name": n} for i, n in EFFORTS]}


def brief():
    d = load()
    act = core.active_accounts()
    best = None
    for acc in act:
        usage, updated = usage_for(d, acc)
        u = usage or {}
        wins = u.get("windows") or []
        w = next((x for x in wins if "5" in x.get("label", "")), wins[0] if wins else None)
        row = {"percent": w.get("percentUsed") if w else None, "resetsAt": w.get("resetsAt") if w else None,
               "status": u.get("status"), "updated": updated, "account": acc}
        if best is None or (row["percent"] or -1) > (best["percent"] or -1):
            best = row
    return dict(best, pending=bool(pending_changes()), accounts=act)
