import { ChevronRight, FolderOpen, LoaderCircle, Save } from 'lucide-react';

export default function Navbar({ health, onSave, onLoad, saving }) {
  const healthText = health === 'online' ? 'Backend connected' : health === 'offline' ? 'Backend offline' : 'Checking backend';
  return (
    <header className="navbar">
      <div className="brand select-none">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="brand-copy"><strong>NexusFlow<span>.</span></strong><small>VISUAL IOT WORKSPACE</small></div>
      </div>
      <div className="nav-breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>Flow editor</strong></div>
      <div className="nav-actions">
        <div className={`health ${health}`} role="status"><span className="health-dot" />{healthText}</div>
        <div className="nav-divider" />
        <button className="button button-secondary" onClick={onLoad}><FolderOpen size={16} /><span>Load graph</span></button>
        <button className="button button-primary" onClick={onSave} disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}<span>{saving ? 'Saving...' : 'Save graph'}</span>
        </button>
      </div>
    </header>
  );
}
