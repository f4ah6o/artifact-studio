import React from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Button } from '@cloudflare/kumo/components/button';
import '@cloudflare/kumo/styles/standalone';
import './artifact-studio-theme.css';
import './styles.css';
import './opa.css';

const controls = [
  {
    slot: 'new-artifact-button-slot',
    id: 'new-artifact-button',
    label: 'New Artifact',
    variant: 'secondary',
    size: 'sm',
  },
  {
    slot: 'ai-session-reset-button-slot',
    id: 'ai-session-reset-button',
    label: 'New AI session',
    variant: 'secondary',
    disabled: true,
  },
  {
    slot: 'codex-login-button-slot',
    id: 'codex-login-button',
    label: 'ChatGPTに接続',
    variant: 'secondary',
    hidden: true,
  },
  {
    slot: 'validate-button-slot',
    id: 'validate-button',
    label: '検証',
    variant: 'secondary',
  },
  {
    slot: 'format-button-slot',
    id: 'format-button',
    label: '整形',
    variant: 'secondary',
    disabled: true,
  },
  {
    slot: 'generate-button-slot',
    id: 'generate-button',
    label: 'AIで生成',
    variant: 'primary',
  },
];

function ShellControlPortals() {
  return controls.map(({ slot, label, ...props }) => {
    const target = document.getElementById(slot);
    if (!target) throw new Error(`Missing Kumo control slot: ${slot}`);
    return createPortal(
      <Button {...props} className="artifact-kumo-button" type="button">
        {label}
      </Button>,
      target,
      slot,
    );
  });
}

const host = document.getElementById('kumo-shell-root');
if (!host) throw new Error('Missing Kumo shell root');

const root = createRoot(host);
flushSync(() => root.render(<ShellControlPortals />));

await import('./main.js');
