"""League-scoped display identity links. Never grant access or rewrite ownership."""
from __future__ import annotations

from src.draft_hub import storage
from src.auth import user_store


def public_accounts(subs):
    """Only fetch the requested public names, in one indexed local query."""
    ids = sorted({str(sub)[3:] for sub in subs if str(sub).startswith("ss:")})
    if not ids:
        return {}
    with user_store.get_conn() as conn:
        rows = conn.execute(f"SELECT id, display_name, updated_at FROM app_user WHERE id IN ({','.join('?' for _ in ids)})", ids).fetchall()
    return {f"ss:{r['id']}": {"account_sub": f"ss:{r['id']}", "display_name": r['display_name'],
                              "updated_at": r['updated_at']} for r in rows}


def mapping_revision(league_id):
    rows = storage.list_manager_account_maps(league_id)
    accounts = public_accounts(r['account_sub'] for r in rows)
    return [(r['id'], r['updated_at'], r['account_sub'],
             (accounts.get(r['account_sub']) or {}).get('display_name')) for r in rows]


def settings(league_id):
    league = storage.get_league(league_id) or {}
    # Reading Rules must not invoke the members endpoint's Sleeper refresh.
    with storage.get_conn() as conn:
        teams = [dict(r) for r in conn.execute(
            "SELECT name, user_sub FROM team WHERE league_id=? AND (is_bot IS NULL OR is_bot=0)", (league_id,))]
        imported = conn.execute("""SELECT DISTINCT owner_label, season_year FROM league_contract_row
            WHERE league_id=? AND owner_label IS NOT NULL ORDER BY owner_label""", (league_id,)).fetchall()
        maps = conn.execute("SELECT owner_label, season_year FROM league_owner_season_map WHERE league_id=? AND source_kind != 'yaml_seed'", (league_id,)).fetchall()
    saved = storage.list_manager_account_maps(league_id)
    accounts = public_accounts([league.get('commissioner_sub'), *[t['user_sub'] for t in teams],
                                *[r['account_sub'] for r in saved]])
    member_subs = {league.get('commissioner_sub'), *[t['user_sub'] for t in teams]}
    choices = [{**a, 'team_name': next((t['name'] for t in teams if t['user_sub'] == sub), '')}
               for sub, a in accounts.items() if sub in member_subs]
    sources = {}
    def add(kind, key, label, year=None):
        key = str(key or '').strip()
        if not key:
            return
        identity = (kind, key.casefold())
        item = sources.setdefault(identity, {'source_kind': kind, 'source_key': key,
                                            'label': str(label or key), 'seasons': []})
        if year and int(year) not in item['seasons']:
            item['seasons'].append(int(year))
    for r in [*imported, *maps]:
        add('owner_label', r['owner_label'], r['owner_label'], r['season_year'])
    sleeper = str(league.get('sleeper_league_id') or '')
    chain = storage.get_sleeper_league_chain(sleeper) if sleeper else []
    for c in chain or ([{'league_id': sleeper}] if sleeper else []):
        cache = storage.get_sleeper_scoring_cache(str(c['league_id'])) or {}
        payload = cache.get('payload') or {}
        for r in payload.get('standings') or []:
            add('sleeper_user_id', r.get('owner_id'), r.get('owner_name') or r.get('team_name'),
                payload.get('season') or c.get('season'))
    for r in saved:
        add(r['source_kind'], r['source_key'], r['source_key'])
    return {'sources': sorted(sources.values(), key=lambda r: (r['label'].casefold(), r['source_kind'])),
            'accounts': sorted(choices, key=lambda a: a['display_name'].casefold()),
            'mappings': [{**r, 'display_name': (accounts.get(r['account_sub']) or {}).get('display_name'),
                          'source_label': sources[(r['source_kind'], r['source_key'].casefold())]['label']}
                         for r in saved]}


def save(league_id, source_kind, source_key, account_sub, season_year=0):
    if not storage.verify_league_membership(account_sub, league_id) or account_sub not in public_accounts([account_sub]):
        raise ValueError('Choose a registered account that has joined this league.')
    if source_kind == 'sleeper_user_id':
        sources = settings(league_id)['sources']
        if not any(r['source_kind'] == source_kind and r['source_key'] == source_key for r in sources):
            raise ValueError('Choose a saved Sleeper manager from this league.')
    return storage.upsert_manager_account_map(league_id, source_kind, source_key, account_sub, season_year)


class ManagerOwnerMap(dict):
    """A normal serializable name map with exact, season-aware alias resolution."""
    def __init__(self, raw, league_id, season_year):
        self.original = dict(raw)
        self.season_year = int(season_year) if str(season_year).isdigit() else 0
        rows = storage.list_manager_account_maps(league_id)
        accounts = public_accounts(r['account_sub'] for r in rows)
        self.links = {(r['source_kind'], r['source_key'].casefold(), r['season_year']):
                      accounts[r['account_sub']] for r in rows if r['account_sub'] in accounts}
        with storage.get_conn() as conn:
            aliases = conn.execute("SELECT owner_label, sleeper_user_id, season_year FROM league_owner_season_map WHERE league_id=?", (league_id,)).fetchall()
        candidates = {}
        for row in aliases:
            account = self.account(uid=row['sleeper_user_id'], season=row['season_year'])
            if account:
                key = ('owner_label', row['owner_label'].strip().casefold(), row['season_year'])
                candidates.setdefault(key, {})[account['account_sub']] = account
        for key, choices in candidates.items():
            if len(choices) == 1:
                self.links.setdefault(key, next(iter(choices.values())))
        super().__init__({k: self.resolve(v) or v for k, v in raw.items()})

    def account(self, owner=None, uid=None, season=None):
        year = int(season) if str(season).isdigit() else self.season_year
        for kind, key in [('sleeper_user_id', uid), ('owner_label', owner)]:
            if key:
                for yr in dict.fromkeys([year, 0]):
                    hit = self.links.get((kind, str(key).strip().casefold(), yr))
                    if hit:
                        return hit
        return None

    def resolve(self, owner=None, uid=None, season=None):
        hit = self.account(owner, uid, season)
        return hit['display_name'] if hit else None
