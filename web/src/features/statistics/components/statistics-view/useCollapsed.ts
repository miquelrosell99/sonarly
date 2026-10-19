import { useState } from 'react';

export function useCollapsed() {
  const [expanded, setExpanded] = useState(false);
  return { expanded, limit: expanded ? 10 : 5, toggle: () => setExpanded((v) => !v) };
}
