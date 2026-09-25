/**
 * Compare the official eTrade / MoR record against what is registered, and
 * produce the consent checkbox list used by both TIN-verify flows (the entity
 * edit modal and the row-level verify modal in Channel Reports).
 *
 * Each entry names the field, the **official** value it would come `from`, and
 * the **registered** value it would replace (`to`). A field only appears when
 * eTrade actually returned something for it — and, where the value already
 * matches, not at all.
 */
export function buildVerifyChoices(entity, form, res) {
  const d = res || {};
  const level = Number(entity?.level);
  const list = [];

  if (d.trade_name && d.trade_name !== (form?.user_name || entity?.user_name || '').trim()) {
    list.push({
      field: 'business_name',
      label: 'Business Name',
      from: d.trade_name,
      to: form?.user_name || entity?.user_name || '',
    });
  }

  if (d.mobile_phone) {
    const official = d.mobile_phone.startsWith('251') ? `0${d.mobile_phone.slice(3)}` : d.mobile_phone;
    if (official !== (entity?.mobile_number || '')) {
      list.push({
        field: 'phone',
        label: 'Phone Number',
        from: official,
        to: entity?.mobile_number || '',
      });
    }
  }

  if (d.location) {
    list.push({
      field: 'location',
      label: 'Location',
      from: d.location,
      to: form?.location || '',
    });
  }

  if (level !== 2 && (d.parish_name || d.geo_domain)) {
    const officialGeo = d.parish_name || d.geo_domain;
    if (officialGeo !== (form?.geo_domain_raw || '')) {
      list.push({
        field: 'geo_domain',
        label: 'Geographical Domain',
        from: officialGeo,
        to: form?.geo_domain_raw || '',
      });
    }
  }

  if (d.photo) {
    list.push({
      field: 'photo',
      label: 'Manager Photo',
      from: d.photo.manager_name_eng || d.photo.manager_name || 'official record',
      to: 'current photo',
    });
  }

  return list;
}
