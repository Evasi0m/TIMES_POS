import React from 'react';
import Icon from '../../ui/Icon.jsx';
import ExpandableImageThumb from '../../ui/ExpandableImageThumb.jsx';

export default function SkuThumb({ url, sizeClass = 'w-12 h-12', iconSize = 20, alt = '' }) {
  return (
    <ExpandableImageThumb
      src={url}
      alt={alt}
      className={`${sizeClass} rounded-lg border hairline bg-white shrink-0`}
      imgClassName="w-full h-full object-cover rounded-lg"
      placeholder={(
        <div className={`${sizeClass} rounded-lg bg-surface-soft border hairline flex items-center justify-center text-muted shrink-0 product-img-shadow`}>
          <Icon name="image" size={iconSize}/>
        </div>
      )}
    />
  );
}
