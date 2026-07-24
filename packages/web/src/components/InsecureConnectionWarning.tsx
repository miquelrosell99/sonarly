import { useEffect, useState } from 'react';
import { Icon } from './ui/Icon.js';

export function InsecureConnectionWarning() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(window.location.protocol === 'http:');
  }, []);

  if (!show) return null;

  return (
    <div
      className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-600"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <Icon name="mdi-alert-outline" size={18} className="mt-0.5 shrink-0" />
        <p>
          This page is not using HTTPS. Passwords and other data will be sent unencrypted over the
          network. Use a reverse proxy with TLS (e.g., nginx, Caddy, Traefik) for a secure
          connection.
        </p>
      </div>
    </div>
  );
}
