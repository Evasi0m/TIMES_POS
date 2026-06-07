// Validation for full Thai tax invoice buyer block (ม.86/4).

/** Requires name, address, and a 10–13 digit tax ID. */
export function fullBuyerValid(b) {
  return !!(
    b &&
    b.name?.trim() &&
    b.address?.trim() &&
    /^\d{10,13}$/.test((b.taxId || '').replace(/\D/g, ''))
  );
}
