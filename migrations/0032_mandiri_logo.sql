-- Mandiri's logo is now its own artwork (public/banks/mandiri.png) on the bank's colour, not the drawn one.
UPDATE banks SET logo = 'mandiri.png' WHERE id = 'mandiri' AND logo = 'mandiri';
