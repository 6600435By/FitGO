'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const DISMISS_KEY = 'fitgo_pwa_tip_dismissed';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return true;
  const mq = window.matchMedia('(display-mode: standalone)').matches;
  const ios =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return mq || ios;
}

function isMobileUa(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isSafari(): boolean {
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/i.test(ua);
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function PwaInstallTip() {
  const [visible, setVisible] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const mobile = useMemo(() => isMobileUa(), []);
  const ios = useMemo(() => isIos(), []);

  useEffect(() => {
    if (!mobile || isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      /* ignore */
    }
    setVisible(true);

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBip);

    if (isStandalone()) {
      const token = getToken();
      if (token) {
        void api.markPwaInstalled(token, true).catch(() => undefined);
      }
    }

    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, [mobile]);

  useEffect(() => {
    if (!isStandalone()) return;
    const token = getToken();
    if (token) {
      void api.markPwaInstalled(token, true).catch(() => undefined);
    }
  }, []);

  if (!visible || !mobile || isStandalone()) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  const installAndroid = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      const token = getToken();
      if (token) void api.markPwaInstalled(token, true).catch(() => undefined);
      setVisible(false);
      return;
    }
  };

  return (
    <div className="mb-3 rounded-3xl border border-forma-500/35 bg-ink-elevated/95 p-4 text-sm text-zinc-200 shadow-forma-glow/20">
      <div className="flex items-start justify-between gap-2">
        <p className="font-display font-semibold text-forma-400">
          Forma на экран Домой
        </p>
        <button
          type="button"
          className="text-zinc-500 hover:text-white"
          onClick={dismiss}
          aria-label="Закрыть"
        >
          ×
        </button>
      </div>
      {ios ? (
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-zinc-300">
          {!isSafari() && <li>Откройте эту страницу в Safari</li>}
          <li>Нажмите «Поделиться»</li>
          <li>Выберите «На экран „Домой“»</li>
        </ol>
      ) : (
        <div className="mt-2 space-y-2 text-zinc-300">
          <p>
            Добавьте ярлык — кабинет откроется как приложение, без браузерной
            строки.
          </p>
          {deferred ? (
            <button
              type="button"
              className="btn-primary w-full bg-forma-500 text-ink hover:bg-forma-400"
              onClick={() => void installAndroid()}
            >
              Установить
            </button>
          ) : (
            <p className="text-xs text-zinc-500">
              Меню Chrome → «Добавить на главный экран»
            </p>
          )}
        </div>
      )}
    </div>
  );
}
