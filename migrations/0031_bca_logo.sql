-- BCA's logo is now its own artwork (public/banks/bca.png) on the bank's colour, not the drawn one.
UPDATE banks SET logo = 'bca.png' WHERE id = 'bca' AND logo = 'bca';
