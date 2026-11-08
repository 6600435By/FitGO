'use client';

import type {
  TrainerClientSummary,
  TrainerLedgerOverview,
  TrainerOwnPackageTemplate,
  TrainerPaymentMethod,
} from '@fitgo/shared-types';
import {
  AnimatedNumber,
  BentoCard,
  EmptyState,
  ListGroup,
  ListRow,
  PageHeader,
  SegmentedControl,
} from '@fitgo/forma-ui';
import { Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { downloadCsv, downloadExcel } from '@/lib/download-table';

function money(minor: number) {
  return `${(minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} BYN`;
}

function methodRu(m: TrainerPaymentMethod) {
  if (m === 'CASH') return 'Наличные';
  if (m === 'TRANSFER') return 'Перевод';
  return 'Карта';
}

type Tab = 'overview' | 'debtors' | 'packages' | 'payments';

export default function TrainerMyPaymentsPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<TrainerLedgerOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [tplTitle, setTplTitle] = useState('');
  const [tplSessions, setTplSessions] = useState('10');
  const [tplPrice, setTplPrice] = useState('300');
  const [tplDays, setTplDays] = useState('90');
  const [sessionPrice, setSessionPrice] = useState('');

  const [payClientId, setPayClientId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<TrainerPaymentMethod>('CASH');

  const [sellClientId, setSellClientId] = useState('');
  const [sellClientQ, setSellClientQ] = useState('');
  const [sellTemplateId, setSellTemplateId] = useState('');
  const [roster, setRoster] = useState<TrainerClientSummary[]>([]);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .trainerLedgerOverview(token)
      .then((o) => {
        setData(o);
        setSessionPrice(
          o.defaultSessionPriceMinor != null
            ? String(o.defaultSessionPriceMinor / 100)
            : '',
        );
        if (!sellTemplateId && o.templates[0]) {
          setSellTemplateId(o.templates[0].id);
        }
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Ошибка загрузки'),
      );
  }, [sellTemplateId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .trainerClients(token)
      .then(setRoster)
      .catch(() => setRoster([]));
  }, []);

  const sellClientOptions = useMemo(() => {
    const needle = sellClientQ.trim().toLowerCase();
    const list = !needle
      ? roster
      : roster.filter((c) =>
          `${c.firstName} ${c.lastName} ${c.phone ?? ''}`
            .toLowerCase()
            .includes(needle),
        );
    return list.slice(0, 80);
  }, [roster, sellClientQ]);

  const saveTemplate = async () => {
    const token = getToken();
    if (!token || !tplTitle.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.trainerLedgerUpsertPackage(token, {
        title: tplTitle.trim(),
        sessionsCount: Number(tplSessions) || 1,
        priceMinor: Math.round((Number(tplPrice) || 0) * 100),
        validityDays: tplDays ? Number(tplDays) : null,
      });
      setTplTitle('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const saveSessionPrice = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      const v = sessionPrice.trim();
      await api.trainerLedgerSetSessionPrice(
        token,
        v === '' ? null : Math.round(Number(v) * 100),
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить цену');
    } finally {
      setBusy(false);
    }
  };

  const recordDebtPayment = async () => {
    const token = getToken();
    if (!token || !payClientId || !payAmount) return;
    setBusy(true);
    setError('');
    try {
      await api.trainerLedgerRecordPayment(token, {
        clientId: payClientId,
        amountMinor: Math.round(Number(payAmount) * 100),
        method: payMethod,
        kind: 'DEBT_PAYMENT',
        applyToDebt: true,
      });
      setPayAmount('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось записать оплату');
    } finally {
      setBusy(false);
    }
  };

  const sellPackage = async () => {
    const token = getToken();
    if (!token || !sellClientId || !sellTemplateId) return;
    setBusy(true);
    setError('');
    try {
      await api.trainerLedgerSellPackage(token, {
        clientId: sellClientId,
        templateId: sellTemplateId,
        method: 'CASH',
      });
      setSellClientId('');
      load();
      setTab('overview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось продать пакет');
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Расчёты" subtitle="Личный учёт с клиентами" />
        <div className="h-24 animate-pulse rounded-2xl bg-forma-800/40" />
      </div>
    );
  }

  const exportHeaders = [
    'date',
    'client',
    'amountByn',
    'method',
    'kind',
    'comment',
  ];
  const exportRows = data.recentPayments.map((p) => [
    p.paidAt.slice(0, 10),
    p.clientName,
    p.amountMinor / 100,
    methodRu(p.method),
    p.kind,
    p.comment ?? '',
  ]);
  const exportStamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Расчёты"
        subtitle="Пакеты и оплаты клиентов, должники, долг перед клубом"
        action={
          data.recentPayments.length ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary px-3 py-2 text-xs"
                onClick={() =>
                  downloadCsv(
                    exportHeaders,
                    exportRows,
                    `moi-oplaty-${exportStamp}.csv`,
                  )
                }
              >
                CSV
              </button>
              <button
                type="button"
                className="btn-secondary px-3 py-2 text-xs"
                onClick={() =>
                  downloadExcel(
                    exportHeaders,
                    exportRows,
                    `moi-oplaty-${exportStamp}`,
                    'Оплаты',
                  )
                }
              >
                Excel
              </button>
            </div>
          ) : undefined
        }
      />

      {error && (
        <p className="rounded-xl bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Обзор' },
          { value: 'debtors', label: 'Должники' },
          { value: 'packages', label: 'Пакеты' },
          { value: 'payments', label: 'Оплаты' },
        ]}
      />

      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <BentoCard className="p-4">
              <p className="text-xs text-forma-400">За месяц</p>
              <p className="mt-1 text-xl font-semibold text-forma-50">
                <AnimatedNumber
                  value={data.monthEarnedMinor / 100}
                  decimals={2}
                />{' '}
                BYN
              </p>
            </BentoCard>
            <BentoCard className="p-4">
              <p className="text-xs text-forma-400">Всего</p>
              <p className="mt-1 text-xl font-semibold text-forma-50">
                {money(data.allTimeEarnedMinor)}
              </p>
            </BentoCard>
            <BentoCard className="p-4">
              <p className="text-xs text-forma-400">Ожидается</p>
              <p className="mt-1 text-xl font-semibold text-forma-50">
                {money(data.expectedMinor)}
              </p>
            </BentoCard>
            <BentoCard className="p-4">
              <p className="text-xs text-forma-400">Должники</p>
              <p className="mt-1 text-xl font-semibold text-forma-50">
                {data.debtorsCount} · {money(data.debtorsTotalMinor)}
              </p>
            </BentoCard>
          </div>

          {data.clubDebtMinor > 0 && (
            <BentoCard className="border border-amber-500/30 p-4">
              <p className="text-xs text-amber-200/80">Ваш долг перед клубом</p>
              <p className="mt-1 text-lg font-semibold text-amber-100">
                {money(data.clubDebtMinor)}
              </p>
              <p className="mt-1 text-xs text-forma-400">
                Из 1С · не связан с личным учётом клиентов
              </p>
            </BentoCard>
          )}

          <BentoCard className="space-y-3 p-4">
            <p className="text-sm font-medium text-forma-100">
              Цена разовой тренировки
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                className="input max-w-[8rem]"
                inputMode="decimal"
                placeholder="BYN"
                value={sessionPrice}
                onChange={(e) => setSessionPrice(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={busy}
                onClick={() => void saveSessionPrice()}
              >
                Сохранить
              </button>
            </div>
            <p className="text-xs text-forma-400">
              Если у клиента нет активного пакета, после тренировки появится
              долг на эту сумму.
            </p>
          </BentoCard>

          <BentoCard className="space-y-3 p-4">
            <p className="text-sm font-medium text-forma-100">Продать пакет</p>
            <input
              className="input"
              placeholder="Поиск клиента…"
              value={sellClientQ}
              onChange={(e) => setSellClientQ(e.target.value)}
            />
            <select
              className="input"
              value={sellClientId}
              onChange={(e) => setSellClientId(e.target.value)}
            >
              <option value="">Клиент из базы</option>
              {sellClientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                  {c.phone ? ` · ${c.phone}` : ''}
                </option>
              ))}
            </select>
            {roster.length === 0 ? (
              <p className="text-xs text-forma-400">
                Нет клиентов в базе — добавьте в разделе «Клиенты».
              </p>
            ) : null}
            <select
              className="input"
              value={sellTemplateId}
              onChange={(e) => setSellTemplateId(e.target.value)}
            >
              {data.templates
                .filter((t) => t.isActive)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} · {t.sessionsCount} тр. · {money(t.priceMinor)}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={busy || !sellClientId || !sellTemplateId}
              onClick={() => void sellPackage()}
            >
              Продать
            </button>
            <p className="text-xs text-forma-400">
              Выберите клиента из доступных — без ручного ID из URL.
            </p>
          </BentoCard>
        </div>
      )}

      {tab === 'debtors' && (
        <div className="space-y-3">
          {data.debtors.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-8 w-8 text-forma-400" />}
              title="Должников нет"
              description="Долг появляется, если тренировка прошла без пакета."
            />
          ) : (
            <ListGroup>
              {data.debtors.map((d) => (
                <ListRow
                  key={d.clientId}
                  title={d.clientName}
                  subtitle={
                    d.activePackage
                      ? `${d.activePackage.title}: ещё ${d.activePackage.sessionsRemaining}`
                      : 'Без пакета'
                  }
                  trailing={
                    <span className="text-sm font-medium text-amber-200">
                      {money(d.debtMinor)}
                    </span>
                  }
                  href={`/trainer/clients/${d.clientId}`}
                />
              ))}
            </ListGroup>
          )}

          <BentoCard className="space-y-3 p-4">
            <p className="text-sm font-medium text-forma-100">Принять оплату долга</p>
            <select
              className="input"
              value={payClientId}
              onChange={(e) => setPayClientId(e.target.value)}
            >
              <option value="">Клиент</option>
              {data.debtors.map((d) => (
                <option key={d.clientId} value={d.clientId}>
                  {d.clientName} · {money(d.debtMinor)}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <input
                className="input max-w-[8rem]"
                inputMode="decimal"
                placeholder="Сумма"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              <select
                className="input max-w-[9rem]"
                value={payMethod}
                onChange={(e) =>
                  setPayMethod(e.target.value as TrainerPaymentMethod)
                }
              >
                <option value="CASH">Наличные</option>
                <option value="TRANSFER">Перевод</option>
                <option value="CARD">Карта</option>
              </select>
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={busy || !payClientId || !payAmount}
                onClick={() => void recordDebtPayment()}
              >
                Записать
              </button>
            </div>
          </BentoCard>
        </div>
      )}

      {tab === 'packages' && (
        <div className="space-y-3">
          <BentoCard className="space-y-3 p-4">
            <p className="text-sm font-medium text-forma-100">Новый шаблон</p>
            <input
              className="input"
              placeholder="Название"
              value={tplTitle}
              onChange={(e) => setTplTitle(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <input
                className="input max-w-[6rem]"
                placeholder="Трен."
                value={tplSessions}
                onChange={(e) => setTplSessions(e.target.value)}
              />
              <input
                className="input max-w-[7rem]"
                placeholder="Цена BYN"
                value={tplPrice}
                onChange={(e) => setTplPrice(e.target.value)}
              />
              <input
                className="input max-w-[7rem]"
                placeholder="Дней"
                value={tplDays}
                onChange={(e) => setTplDays(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={busy || !tplTitle.trim()}
                onClick={() => void saveTemplate()}
              >
                Добавить
              </button>
            </div>
          </BentoCard>

          {data.templates.length === 0 ? (
            <EmptyState
              title="Шаблонов пока нет"
              description="Создайте пакеты, которые продаёте клиентам."
            />
          ) : (
            <ListGroup>
              {data.templates.map((t: TrainerOwnPackageTemplate) => (
                <ListRow
                  key={t.id}
                  title={t.title}
                  subtitle={`${t.sessionsCount} тренировок${
                    t.validityDays ? ` · ${t.validityDays} дн.` : ''
                  }${!t.isActive ? ' · выкл.' : ''}`}
                  trailing={
                    <span className="text-sm text-forma-200">
                      {money(t.priceMinor)}
                    </span>
                  }
                />
              ))}
            </ListGroup>
          )}
        </div>
      )}

      {tab === 'payments' && (
        <div className="space-y-3">
          {data.recentPayments.length === 0 ? (
            <EmptyState
              title="Оплат за месяц нет"
              description="Продажи пакетов и погашение долгов появятся здесь."
            />
          ) : (
            <ListGroup>
              {data.recentPayments.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.clientName}
                  subtitle={`${methodRu(p.method)} · ${new Date(
                    p.paidAt,
                  ).toLocaleString('ru-RU')}${
                    p.comment ? ` · ${p.comment}` : ''
                  }`}
                  trailing={
                    <span className="text-sm font-medium text-forma-100">
                      {money(p.amountMinor)}
                    </span>
                  }
                  href={`/trainer/clients/${p.clientId}`}
                />
              ))}
            </ListGroup>
          )}
        </div>
      )}
    </div>
  );
}
