/**
 * Run: cd apps/api && npx ts-node --transpile-only -r tsconfig-paths/register src/analytics/visit-mix.test.ts
 */
import assert from 'node:assert/strict';
import {
  classifyGroupVisitMix,
  classifySpaVisitMix,
  visitMixFromCounts,
} from '@fitgo/shared-types';

{
  assert.equal(
    classifyGroupVisitMix('Членство "VIP ( 6 месяцев )" 65958 от 02.03.2026'),
    'ABON',
  );
  assert.equal(
    classifyGroupVisitMix('Членство "Единый ( 12месяцев )" 62863 от 30.11.2025'),
    'ABON',
  );
  assert.equal(
    classifyGroupVisitMix('Членство "Легкий старт ( 1 месяц )" 72379 от 10.09.2026'),
    'ABON',
  );
  assert.equal(
    classifyGroupVisitMix('Пакет услуг "Гостевое занятие" 72019 от 01.09.2026'),
    'ABON',
  );
  assert.equal(
    classifyGroupVisitMix('Пакет услуг "Безлимит (12 месяцев)" 43734 от 14.05.2024'),
    'ABON',
  );
  assert.equal(
    classifyGroupVisitMix('Пакет услуг "Пробное занятие" 1 от 01.01.2026'),
    'ABON',
  );
  assert.equal(
    classifyGroupVisitMix(
      'Членство "Все включено ( 3 месяца )" 69107 от 30.05.2026',
    ),
    'ABON',
  );
  assert.equal(classifyGroupVisitMix(''), 'ABON');
  assert.equal(classifyGroupVisitMix(null), 'ABON');
}

{
  assert.equal(
    classifyGroupVisitMix(
      'Пакет услуг "Карта посещения (20 посещений)" 71993 от 31.08.2026',
    ),
    'KP',
  );
  assert.equal(
    classifyGroupVisitMix('Пакет услуг "РАЗОВОЕ ГРУППОВОЕ" 1 от 01.01.2026'),
    'KP',
  );
  assert.equal(
    classifyGroupVisitMix('олл спортс Allsports гупповое'),
    'KP',
  );
  assert.equal(
    classifyGroupVisitMix(
      'Пакет услуг "Групповоое занятие реформер 8" 72690 от 20.09.2026',
    ),
    'KP',
  );
  assert.equal(
    classifyGroupVisitMix('Пакет услуг "группа АСД Лабс  2019" 71857 от 28.08.2026'),
    'KP',
  );
  assert.equal(
    classifyGroupVisitMix('Пакет услуг "GYM FIT гупповое занятие" 1 от 01.01.2026'),
    'KP',
  );
}

{
  assert.equal(
    classifySpaVisitMix('Членство "VIP ( 6 месяцев )" 65958 от 02.03.2026'),
    'ABON',
  );
  assert.equal(
    classifySpaVisitMix(
      'Членство "Все включено ( 3 месяца )" 69141 от 31.05.2026',
    ),
    'ABON',
  );
  assert.equal(
    classifySpaVisitMix('Членство "Курс массажа 5  (удален)" 72503 от 05.09.2026'),
    'KP',
  );
  assert.equal(classifySpaVisitMix('Продажа 28885 от 18.10.2021'), 'KP');
  assert.equal(classifySpaVisitMix(''), 'KP');
}

{
  assert.deepEqual(visitMixFromCounts(0, 0), {
    abonVisits: 0,
    kpVisits: 0,
    abonPct: null,
    kpPct: null,
  });
  assert.deepEqual(visitMixFromCounts(2, 3), {
    abonVisits: 2,
    kpVisits: 3,
    abonPct: 40,
    kpPct: 60,
  });
  assert.deepEqual(visitMixFromCounts(1, 0), {
    abonVisits: 1,
    kpVisits: 0,
    abonPct: 100,
    kpPct: 0,
  });
}

console.log('visit-mix.test.ts: ok');
