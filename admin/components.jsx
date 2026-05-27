/* Nutrition Admin — Icons & UI primitives */

const Icon = ({ name, size = 16, className = '', style }) => {
  const s = { width: size, height: size, ...style };
  const stroke = 'currentColor';
  const sw = 1.6;
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round', className };
  switch (name) {
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>;
    case 'chevron-right':
      return <svg {...common}><path d="m9 6 6 6-6 6"/></svg>;
    case 'chevron-left':
      return <svg {...common}><path d="m15 6-6 6 6 6"/></svg>;
    case 'chevron-down':
      return <svg {...common}><path d="m6 9 6 6 6-6"/></svg>;
    case 'x':
      return <svg {...common}><path d="M18 6 6 18M6 6l12 12"/></svg>;
    case 'check':
      return <svg {...common}><path d="M5 12.5 9.5 17 19 7"/></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case 'minus':
      return <svg {...common}><path d="M5 12h14"/></svg>;
    case 'map-pin':
      return <svg {...common}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>;
    case 'utensils':
      return <svg {...common}><path d="M4 3v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M6 13v8M14 3c-2 0-3 2-3 4s1 4 3 4v10"/></svg>;
    case 'globe':
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>;
    case 'brain':
      return <svg {...common}><path d="M9.5 3A2.5 2.5 0 0 0 7 5.5v0c-1.5.3-3 1.6-3 3.5 0 1 .5 1.8 1 2.5-.5.7-1 1.5-1 2.5 0 2 1.5 3.2 3 3.5v0A2.5 2.5 0 0 0 9.5 20a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 9.5 3ZM14.5 3a2.5 2.5 0 0 1 2.5 2.5v0c1.5.3 3 1.6 3 3.5 0 1-.5 1.8-1 2.5.5.7 1 1.5 1 2.5 0 2-1.5 3.2-3 3.5v0a2.5 2.5 0 0 1-2.5 2.5 2.5 2.5 0 0 1-2.5-2.5v-11A2.5 2.5 0 0 1 14.5 3Z"/></svg>;
    case 'copy':
      return <svg {...common}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>;
    case 'play':
      return <svg {...common}><path d="M6 5v14l13-7z" fill={stroke}/></svg>;
    case 'pause':
      return <svg {...common}><rect x="7" y="5" width="3" height="14" fill={stroke}/><rect x="14" y="5" width="3" height="14" fill={stroke}/></svg>;
    case 'refresh':
      return <svg {...common}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>;
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case 'circle':
      return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
    case 'alert':
      return <svg {...common}><path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v4M12 18h.01"/></svg>;
    case 'check-circle':
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-5"/></svg>;
    case 'x-circle':
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>;
    case 'star':
      return <svg {...common}><path d="m12 3 2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1L6.6 19.3l1.3-6L3.3 9.2l6.1-.6L12 3Z"/></svg>;
    case 'eye':
      return <svg {...common}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>;
    case 'image':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m3 17 5-5 5 5 3-3 5 5"/></svg>;
    case 'filter':
      return <svg {...common}><path d="M3 5h18l-7 9v6l-4-2v-4L3 5Z"/></svg>;
    case 'walking':
      return <svg {...common}><circle cx="13" cy="4" r="1.8"/><path d="m9 21 2-7 3 2v5M10.5 11l-3.5-1 1-4M14 14l3-1 1 3"/></svg>;
    case 'dollar':
      return <svg {...common}><path d="M12 3v18M16 7H9.5A2.5 2.5 0 0 0 9.5 12H14a2.5 2.5 0 0 1 0 5H8"/></svg>;
    case 'zap':
      return <svg {...common}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill={stroke} fillOpacity="0.15"/></svg>;
    case 'layers':
      return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5ZM3 14l9 5 9-5M3 19l9 5 9-5"/></svg>;
    case 'list':
      return <svg {...common}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>;
    case 'grid':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .4 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.4 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .4-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.4-1.9L4.1 7a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.4H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.4 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>;
    case 'phone':
      return <svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L7.9 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 17Z"/></svg>;
    case 'external':
      return <svg {...common}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>;
    case 'trend-up':
      return <svg {...common}><path d="m22 7-9 9-4-4-7 7"/><path d="M16 7h6v6"/></svg>;
    case 'trend-down':
      return <svg {...common}><path d="m22 17-9-9-4 4-7-7"/><path d="M16 17h6v-6"/></svg>;
    case 'database':
      return <svg {...common}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6"/></svg>;
    case 'arrow-up-right':
      return <svg {...common}><path d="M7 17 17 7M7 7h10v10"/></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
  }
};

/* ─── Pill ─── */
const Pill = ({ children, variant = 'default', dot = false }) => {
  const cls = `pill ${variant !== 'default' ? `pill--${variant}` : ''}`;
  return (
    <span className={cls}>
      {dot && <span className="pill__dot"/>}
      {children}
    </span>
  );
};

/* ─── Button ─── */
const Btn = ({ variant = 'secondary', size, block, children, icon, iconRight, onClick, disabled }) => {
  const cls = [
    'btn', `btn--${variant}`,
    size === 'lg' && 'btn--lg',
    block && 'btn--block',
  ].filter(Boolean).join(' ');
  return (
    <button className={cls} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={size === 'lg' ? 16 : 14}/>}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'lg' ? 16 : 14}/>}
    </button>
  );
};

/* ─── Search input ─── */
const Search = ({ placeholder = 'Search', value, onChange, shortcut = '⌘ K' }) => (
  <div className="search">
    <Icon name="search" size={14} style={{ color: 'var(--c-text-3)' }}/>
    <input placeholder={placeholder} value={value} onChange={e => onChange?.(e.target.value)}/>
    <span className="search__shortcut">{shortcut}</span>
  </div>
);

Object.assign(window, { Icon, Pill, Btn, Search });
