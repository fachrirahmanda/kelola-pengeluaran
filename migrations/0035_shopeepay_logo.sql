-- ShopeePay's logo is now its own icon (public/banks/shopeepay.jpg), which fills the badge.
UPDATE banks SET logo = 'shopeepay.jpg' WHERE id = 'shopeepay' AND logo = 'shopeepay';
