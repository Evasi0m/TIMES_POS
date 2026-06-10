import React from 'react';
import Icon from '../../../ui/Icon.jsx';

/** KPI tile — stat strip + health metrics */
export default function TikTokGlassStat({
  icon,
  label,
  value,
  warn = false,
  hint,
  tone,
  className = '',
}) {
  if (tone) {
    return (
      <div className={'tt-glass__metric tt-glass__metric--' + tone + (className ? ' ' + className : '')}>
        <div className="tt-glass__metric-dot" aria-hidden="true"/>
        <div className="tt-glass__metric-label">{label}</div>
        <div className="tt-glass__metric-value">{value}</div>
        {hint && <div className="tt-glass__metric-hint">{hint}</div>}
      </div>
    );
  }

  return (
    <div className={'tt-glass__stat' + (warn ? ' tt-glass__stat--warn' : '') + (className ? ' ' + className : '')}>
      <div className="tt-glass__stat-icon" aria-hidden="true">
        <Icon name={icon} size={14}/>
      </div>
      <div className="tt-glass__stat-body">
        <div className="tt-glass__stat-label">{label}</div>
        <div className={'tt-glass__stat-value' + (warn ? ' tt-glass__stat-value--warn' : '')}>
          {value}
        </div>
      </div>
    </div>
  );
}
