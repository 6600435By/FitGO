'use client';

import { useEffect, useState, type InputHTMLAttributes } from 'react';

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  isNew?: boolean;
};

/** Avoids macOS type=password Latin IME lock so Russian layout works. */
export function PasswordField({
  className = '',
  isNew = false,
  autoComplete,
  lang = 'ru',
  ...props
}: PasswordFieldProps) {
  const [canMask, setCanMask] = useState(true);

  useEffect(() => {
    setCanMask(
      typeof CSS !== 'undefined' && CSS.supports('-webkit-text-security', 'disc'),
    );
  }, []);

  return (
    <input
      {...props}
      type={canMask ? 'text' : 'password'}
      lang={lang}
      inputMode="text"
      autoComplete={autoComplete ?? (isNew ? 'new-password' : 'current-password')}
      className={[className, canMask ? 'field-password-mask' : '']
        .filter(Boolean)
        .join(' ')}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
    />
  );
}
