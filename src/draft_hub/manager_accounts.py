"""League-scoped display identity links. Never grant access or rewrite ownership."""
from __future__ import annotations

import json

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


def saved_manager_standings(league_id):
    """Read only saved identity metadata, without deserializing weekly scoring."""
    league = storage.get_league(league_id) or {}
    sleeper = str(league.get('sleeper_league_id') or '')
    if not sleeper:
        return []
    chain = storage.get_sleeper_league_chain(sleeper) or [{'league_id': sleeper}]
    ids = [str(c['league_id']) for c in chain]
    with storage.get_conn() as conn:
        saved = {r['sleeper_league_id']: dict(r) for r in conn.execute(
            f"SELECT sleeper_league_id, json_extract(payload_json, '$.season') AS season, json_extract(payload_json, '$.standings') AS standings FROM sleeper_scoring_cache WHERE sleeper_league_id IN ({','.join('?' for _ in ids)}) AND json_valid(payload_json)", ids)}
    return [{'league_id': lid, 'season': saved[lid]['season'], 'standings': json.loads(saved[lid]['standings'] or '[]')}
            for lid in ids if lid in saved]


def mapping_revision(league_id):
    rows = storage.list_manager_account_maps(league_id)
    accounts = public_accounts(r['account_sub'] for r in rows)
    return [('mapped-names-v2', r['id'], r['updated_at'], r['account_sub'], r.get('manager_name'),
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
    for c in saved_manager_standings(league_id):
        for r in c['standings']:
            add('sleeper_user_id', r.get('owner_id'), r.get('owner_name') or r.get('team_name'), c['season'])
    for r in saved:
        add(r['source_kind'], r['source_key'], r['source_key'])
    owners = ManagerOwnerMap({}, league_id, 0)
    return {'sources': sorted(sources.values(), key=lambda r: (r['label'].casefold(), r['source_kind'])),
            'accounts': sorted(choices, key=lambda a: a['display_name'].casefold()),
            'mappings': [{**r, 'manager_name': owners.resolve(r['source_key'] if r['source_kind'] == 'owner_label' else None,
                            r['source_key'] if r['source_kind'] == 'sleeper_user_id' else None, r['season_year']),
                          'display_name': (accounts.get(r['account_sub']) or {}).get('display_name'),
                          'source_label': sources[(r['source_kind'], r['source_key'].casefold())]['label']}
                         for r in saved]}


def save(league_id, source_kind, source_key, account_sub, season_year=0, manager_name=None):
    if not storage.verify_league_membership(account_sub, league_id) or account_sub not in public_accounts([account_sub]):
        raise ValueError('Choose a registered account that has joined this league.')
    if source_kind == 'sleeper_user_id':
        sources = settings(league_id)['sources']
        if not any(r['source_kind'] == source_kind and r['source_key'] == source_key for r in sources):
            raise ValueError('Choose a saved Sleeper manager from this league.')
    owners = ManagerOwnerMap({}, league_id, season_year)
    name = (str(manager_name).strip() if manager_name is not None else
            owners.name_for_account(account_sub, season_year) or owners.source_name(source_kind, source_key, season_year))
    return storage.upsert_manager_account_map(league_id, source_kind, source_key, account_sub, season_year, name)


class ManagerOwnerMap(dict):
    """Account identity is stable; the commissioner's manager name is the display label."""
    def __init__(self, raw, league_id, season_year):
        self.original = dict(raw)
        self.season_year = int(season_year) if str(season_year).isdigit() else 0
        rows = storage.list_manager_account_maps(league_id)
        accounts = public_accounts(r['account_sub'] for r in rows)
        league = storage.get_league(league_id) or {}
        self.planning_year = int(league.get('season') or 0)
        with storage.get_conn() as conn:
            self.aliases = [dict(r) for r in conn.execute(
                "SELECT owner_label, sleeper_user_id, season_year FROM league_owner_season_map WHERE league_id=? AND source_kind != 'yaml_seed'", (league_id,))]
            teams = [dict(r) for r in conn.execute(
                "SELECT user_sub, name, sleeper_team_name, sleeper_roster_id FROM team WHERE league_id=?", (league_id,))]
        self.league_id = league_id
        self.sleeper_rows = None
        current_standings = []
        if any(t['user_sub'] in accounts and t['sleeper_roster_id'] for t in teams):
            self.sleeper_rows = saved_manager_standings(league_id)
            current_standings = next((r['standings'] for r in self.sleeper_rows
                if r['league_id'] == str(league.get('sleeper_league_id') or '')), [])
        # Legacy links have no explicit display name. Prefer the earliest imported
        # real name; saved exact season aliases supply names for Sleeper-only links.
        self.account_names = {}
        def preference(row):
            explicit = bool(row.get('manager_name'))
            return (explicit, row['source_kind'] == 'owner_label' if not explicit else False,
                    row['updated_at'] if explicit else '', row['id'] if explicit else -row['id'])
        for row in sorted(rows, key=preference):
            if row['account_sub'] in accounts:
                self.account_names[(row['account_sub'], row['season_year'])] = (
                    row.get('manager_name') or self.source_name(row['source_kind'], row['source_key'], row['season_year']))
        self.links = {}
        for row in rows:
            if row['account_sub'] in accounts:
                self.links[(row['source_kind'], row['source_key'].casefold(), row['season_year'])] = accounts[row['account_sub']]
        # Carry an exact import-name link to its known Sleeper identity, then carry
        # that identity back to other season aliases. Explicit links always win.
        candidates = {}
        for row in self.aliases:
            account = self.account(owner=row['owner_label'], season=row['season_year'])
            if account and row['sleeper_user_id']:
                key = ('sleeper_user_id', str(row['sleeper_user_id']).casefold(), row['season_year'])
                candidates.setdefault(key, {})[account['account_sub']] = account
        for key, choices in candidates.items():
            if len(choices) == 1:
                self.links.setdefault(key, next(iter(choices.values())))
        career_candidates = {}
        for (kind, key, _year), account in self.links.items():
            if kind == 'sleeper_user_id':
                career_candidates.setdefault(key, {})[account['account_sub']] = account
        for key, choices in career_candidates.items():
            if len(choices) == 1 and self.name_for_account(next(iter(choices))):
                self.links.setdefault(('sleeper_user_id', key, 0), next(iter(choices.values())))
        # Current claimed seats are authoritative for current-season account/ID
        # joins, never evidence for an unrelated historical seat.
        self.team_accounts = {}
        for team in teams:
            sub = team['user_sub']
            if not self.name_for_account(sub, self.planning_year):
                continue
            for name in [team['name'], team['sleeper_team_name']]:
                if name:
                    self.team_accounts[str(name).strip().casefold()] = sub
            for row in current_standings:
                if team['sleeper_roster_id'] and str(row.get('roster_id')) == str(team['sleeper_roster_id']) and row.get('owner_id'):
                    self.links.setdefault(('sleeper_user_id', str(row['owner_id']).casefold(), self.planning_year), accounts[sub])
        for row in self.aliases:
            account = self.account(uid=row['sleeper_user_id'], season=row['season_year'])
            if account:
                self.links.setdefault(('owner_label', row['owner_label'].strip().casefold(), row['season_year']), account)
        # Exact public account labels can appear in imported analytics. Resolve
        # only a unique linked league account, never fuzzy/global name matches.
        label_candidates = {}
        for sub, account in accounts.items():
            label_candidates.setdefault(account['display_name'].strip().casefold(), {})[sub] = account
        for label, choices in label_candidates.items():
            if len(choices) == 1:
                self.links.setdefault(('owner_label', label, 0), next(iter(choices.values())))
        super().__init__({k: (self.name_for_account(self.team_accounts.get(str(k).strip().casefold()), self.season_year)
                        if self.season_year == self.planning_year else None) or self.resolve(v) or v for k, v in raw.items()})

    def source_name(self, kind, key, season=0):
        if kind == 'owner_label':
            return str(key or '').strip()
        matches = [r for r in self.aliases if str(r['sleeper_user_id']) == str(key)
                   and (not season or int(r['season_year']) == int(season))]
        names = {r['owner_label'].strip() for r in matches}
        if len(names) == 1:
            return next(iter(names))
        if self.sleeper_rows is None:
            self.sleeper_rows = saved_manager_standings(self.league_id)
        for cached in self.sleeper_rows:
            for row in cached['standings']:
                if str(row.get('owner_id')) == str(key) and row.get('owner_name'):
                    return row['owner_name']
        return str(key or '').strip()

    def name_for_account(self, sub, season=None):
        year = int(season) if str(season).isdigit() else self.season_year
        return self.account_names.get((sub, year)) or self.account_names.get((sub, 0))

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
        return self.name_for_account(hit['account_sub'], season) if hit else None
