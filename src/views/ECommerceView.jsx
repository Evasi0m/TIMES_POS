// E-Commerce — platform จาก sidebar group, TikTok sections แยกหน้า.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import EcommerceBrandIcon from '../components/ecommerce/EcommerceBrandIcon.jsx';
import TikTokPanel from '../components/ecommerce/TikTokPanel.jsx';
import ComingSoonPanel from '../components/ecommerce/ComingSoonPanel.jsx';
import TikTokSyncOverlay from '../components/ui/TikTokSyncOverlay.jsx';
import {
  parseEcommerceView,
  tiktokSectionsForRole,
} from '../lib/ecommerce-nav.js';
import { TikTokGlassTabs } from '../components/ecommerce/tiktok/glass/index.js';

function TikTokSectionNav({ view, setView, disabled, isSuperAdmin }) {
  const sections = tiktokSectionsForRole(isSuperAdmin);
  const tabs = sections.map((s) => ({ key: s.view, label: s.label }));
  return (
    <TikTokGlassTabs
      tabs={tabs}
      activeKey={view}
      onSelect={setView}
      disabled={disabled}
      variant="nav"
      className="flex-wrap"
    />
  );
}

export default function ECommerceView({ view, setView, toast, isSuperAdmin = false }) {
  const { platform, section } = parseEcommerceView(view);
  const [pageSync, setPageSync] = useState({ visible: false, pct: 0, phase: 'in' });
  const [syncTop, setSyncTop] = useState(0);
  const fadeTimerRef = useRef(null);
  const headerRef = useRef(null);
  const wasPageSyncingRef = useRef(false);

  const pageTitle = platform === 'tiktok'
    ? 'TikTok Shop'
    : platform === 'shopee'
      ? 'Shopee'
      : 'Lazada';

  const measureSyncTop = useCallback(() => {
    if (headerRef.current) {
      setSyncTop(headerRef.current.getBoundingClientRect().bottom);
    }
  }, []);

  const handleSyncChange = useCallback(({ syncing, pct }) => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (syncing) {
      wasPageSyncingRef.current = true;
      setPageSync({ visible: true, pct, phase: 'in' });
      return;
    }
    if (!wasPageSyncingRef.current) return;
    wasPageSyncingRef.current = false;
    setPageSync(s => ({ visible: true, pct: Math.max(pct, s.pct), phase: 'out' }));
    fadeTimerRef.current = window.setTimeout(() => {
      setPageSync({ visible: false, pct: 0, phase: 'in' });
      fadeTimerRef.current = null;
    }, 320);
  }, []);

  useLayoutEffect(() => {
    if (!pageSync.visible) return;
    measureSyncTop();
    window.addEventListener('resize', measureSyncTop);
    window.addEventListener('scroll', measureSyncTop, true);
    return () => {
      window.removeEventListener('resize', measureSyncTop);
      window.removeEventListener('scroll', measureSyncTop, true);
    };
  }, [pageSync.visible, measureSyncTop]);

  useEffect(() => () => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('tiktok') === 'connected' || p.get('tiktok_error')) {
      setView('ecommerce-tiktok-orders');
    }
  }, [setView]);

  useEffect(() => {
    if (platform === 'tiktok' && (section === 'matching' || section === 'stock') && !isSuperAdmin) {
      setView('ecommerce-tiktok-orders');
    }
  }, [platform, section, isSuperAdmin, setView]);

  const pageBlocked = pageSync.visible;
  const syncOverlayStyle = { '--ttc-sync-top': `${syncTop}px` };

  if (platform === 'tiktok') {
    return (
      <>
        <header ref={headerRef} className="hidden lg:flex px-10 pt-8 pb-6 border-b hairline">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-5xl leading-tight text-ink">{pageTitle}</h1>
          </div>
        </header>

        <div className="relative">
          {pageSync.visible && (
            <TikTokSyncOverlay
              pct={pageSync.pct}
              phase={pageSync.phase}
              layout="page"
              style={syncOverlayStyle}
            />
          )}
          <div className={pageBlocked ? 'pointer-events-none select-none' : ''}>
            <div className="px-4 lg:px-10 pt-5 lg:pt-6">
              <div className="tt-glass">
                <TikTokSectionNav view={view} setView={setView} disabled={pageBlocked} isSuperAdmin={isSuperAdmin}/>
              </div>
            </div>

            <div className="px-4 lg:px-10 pt-4 lg:pt-5 pb-8">
              <TikTokPanel
                toast={toast}
                section={section}
                isSuperAdmin={isSuperAdmin}
                setView={setView}
                onSyncChange={handleSyncChange}
              />
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <header className="hidden lg:flex px-10 pt-8 pb-4 border-b hairline">
        <div className="flex items-center gap-3">
          {platform !== 'tiktok' && (
            <EcommerceBrandIcon brand={platform} size={40}/>
          )}
          <h1 className="font-display text-5xl leading-tight text-ink">{pageTitle}</h1>
        </div>
      </header>

      <div className="px-4 lg:px-10 pb-8">
        {platform === 'shopee' && (
          <ComingSoonPanel
            brand="shopee"
            name="Shopee"
            note="จะเชื่อมต่อ Shopee Open API ในขั้นตอนถัดไป"
          />
        )}
        {platform === 'lazada' && (
          <ComingSoonPanel
            brand="lazada"
            name="Lazada"
            note="จะเชื่อมต่อ Lazada Open Platform ในขั้นตอนถัดไป"
          />
        )}
      </div>
    </div>
  );
}
