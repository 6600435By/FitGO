/**
 * Admin home layout catalog + settings helpers.
 * Run: npx tsx --test packages/shared-types/src/admin-home-layout.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_HOME_DEFAULT_PINS,
  ADMIN_HOME_DEFAULT_WIDGETS,
  ADMIN_HOME_PANEL_PRESETS,
  ADMIN_HOME_PINS,
  ADMIN_HOME_PRESETS,
  ADMIN_HOME_SETTINGS_ZONES,
  ADMIN_HOME_WIDGETS,
  matchingAdminHomePreset,
  normalizeAdminHomeWidgets,
  toggleAdminHomeWidget,
  type AdminHomePinId,
  type AdminHomeWidgetId,
} from './admin-home-layout';

describe('ADMIN_HOME_SETTINGS_ZONES', () => {
  it('lists zones top → metrics → tasks → nav', () => {
    assert.deepEqual(
      ADMIN_HOME_SETTINGS_ZONES.map((z) => z.id),
      ['top', 'metrics', 'tasks', 'nav'],
    );
  });

  it('keeps nested task rows under the same group as their parent', () => {
    const tasksZone = ADMIN_HOME_SETTINGS_ZONES.find((z) => z.id === 'tasks')!;
    const clients = tasksZone.groups.find((g) => g.label === 'Клиенты')!;
    assert.deepEqual(
      clients.rows.map((r) => r.id),
      [
        'task:clients',
        'task:membership',
        'task:birthday',
        'task:client_debt',
        'task:installment',
      ],
    );
    assert.ok(clients.rows.slice(1).every((r) => r.nested));

    const control = tasksZone.groups.find(
      (g) => g.label === 'Подтвердить запись',
    )!;
    assert.deepEqual(
      control.rows.map((r) => r.id),
      [
        'task:control',
        'task:group_approval',
        'task:pt_approval',
        'task:spa_approval',
        'task:confirmation',
      ],
    );
    assert.ok(control.rows.slice(1).every((r) => r.nested));
  });

  it('references only known widget and pin ids', () => {
    const widgetIds = new Set(ADMIN_HOME_WIDGETS.map((w) => w.id));
    const pinIds = new Set(ADMIN_HOME_PINS.map((p) => p.id));
    for (const zone of ADMIN_HOME_SETTINGS_ZONES) {
      for (const group of zone.groups) {
        for (const row of group.rows) {
          if (row.kind === 'widget') {
            assert.ok(
              widgetIds.has(row.id as AdminHomeWidgetId),
              `unknown widget ${row.id}`,
            );
          } else {
            assert.ok(
              pinIds.has(row.id as AdminHomePinId),
              `unknown pin ${row.id}`,
            );
          }
        }
      }
    }
  });
});

describe('ADMIN_HOME_PANEL_PRESETS', () => {
  it('excludes «Всё» — reset is «Как у всех»', () => {
    assert.deepEqual(ADMIN_HOME_PANEL_PRESETS, [
      'reception',
      'floor',
      'money',
    ]);
    assert.equal(ADMIN_HOME_PRESETS.all.label, 'Всё');
  });
});

describe('toggleAdminHomeWidget / normalizeAdminHomeWidgets', () => {
  it('turning on focus removes callToday', () => {
    const next = toggleAdminHomeWidget(
      ['callToday', 'revenueToday'],
      'focus',
      true,
    );
    assert.ok(next.includes('focus'));
    assert.ok(!next.includes('callToday'));
    assert.ok(next.includes('revenueToday'));
  });

  it('turning on callToday removes focus', () => {
    const next = toggleAdminHomeWidget(
      ['focus', 'needsReview'],
      'callToday',
      true,
    );
    assert.ok(next.includes('callToday'));
    assert.ok(!next.includes('focus'));
    assert.ok(next.includes('needsReview'));
  });

  it('normalize drops callToday when both are present (focus wins)', () => {
    const next = normalizeAdminHomeWidgets([
      'focus',
      'callToday',
      'sessionsToday',
    ]);
    assert.deepEqual(next, ['focus', 'sessionsToday']);
  });

  it('normalize keeps callToday alone', () => {
    assert.deepEqual(normalizeAdminHomeWidgets(['callToday', 'revenueToday']), [
      'callToday',
      'revenueToday',
    ]);
  });
});

describe('matchingAdminHomePreset', () => {
  it('matches reception regardless of order', () => {
    const { widgets, pins } = ADMIN_HOME_PRESETS.reception;
    assert.equal(
      matchingAdminHomePreset([...widgets].reverse(), [...pins].reverse()),
      'reception',
    );
  });

  it('matches floor and money', () => {
    assert.equal(
      matchingAdminHomePreset(
        ADMIN_HOME_PRESETS.floor.widgets,
        ADMIN_HOME_PRESETS.floor.pins,
      ),
      'floor',
    );
    assert.equal(
      matchingAdminHomePreset(
        ADMIN_HOME_PRESETS.money.widgets,
        ADMIN_HOME_PRESETS.money.pins,
      ),
      'money',
    );
  });

  it('returns null for default «all» / club default (not a panel preset)', () => {
    assert.equal(
      matchingAdminHomePreset(
        [...ADMIN_HOME_DEFAULT_WIDGETS],
        [...ADMIN_HOME_DEFAULT_PINS],
      ),
      null,
    );
  });

  it('returns null when one pin differs', () => {
    const { widgets, pins } = ADMIN_HOME_PRESETS.reception;
    assert.equal(
      matchingAdminHomePreset(
        widgets,
        pins.filter((p) => p !== 'nav:/admin/tasks'),
      ),
      null,
    );
  });

  it('ignores module-gated pins when matching with isEnabled', () => {
    const { widgets, pins } = ADMIN_HOME_PRESETS.reception;
    const withoutPt = pins.filter((p) => p !== 'task:pt_approval');
    const allPerms = [
      'CLIENTS_VIEW',
      'REPORTS_VIEW',
      'AT_RISK_VIEW',
      'FUNNEL_VIEW',
      'NOTIFICATIONS_SEND',
    ];
    assert.equal(
      matchingAdminHomePreset(
        widgets,
        withoutPt,
        allPerms,
        (m) => m !== 'pt_sheet',
      ),
      'reception',
    );
  });
});
