import React from 'react';
import Icon from '../Icon.jsx';
import EcommerceBrandIcon from '../../ecommerce/EcommerceBrandIcon.jsx';
import {
  channelKeyForOrder,
  channelTitleForOrder,
  channelLabelForOrder,
  channelBadgeStyle,
} from '../../../lib/channel-badge-meta.js';

function brandForKey(key) {
  if (key === 'tiktok' || key === 'tiktok_api') return 'tiktok';
  if (key === 'shopee' || key === 'lazada') return key;
  return null;
}

/** Icon-first channel indicator; optional text pill for desktop. */
export default function ChannelBadge({ order, channel: channelProp, iconOnly = false, size = 18, className = '' }) {
  const key = channelProp || channelKeyForOrder(order);
  const title = order ? channelTitleForOrder(order) : (channelLabelForOrder({ channel: channelProp }) || '');
  const brand = brandForKey(key);

  if (iconOnly) {
    return (
      <span className={'inline-flex items-center justify-center shrink-0 ' + className} title={title} aria-label={title}>
        {brand ? (
          <EcommerceBrandIcon brand={brand} size={size} />
        ) : (
          <Icon name={key === 'facebook' ? 'link' : 'store'} size={size - 2} className="text-primary" />
        )}
      </span>
    );
  }

  const label = order ? channelLabelForOrder(order) : (channelLabelForOrder({ channel: channelProp }));
  return (
    <span style={channelBadgeStyle(key)} title={title} className={className}>
      {label}
    </span>
  );
}

export { channelBadgeStyle, channelLabelForOrder, channelKeyForOrder };
