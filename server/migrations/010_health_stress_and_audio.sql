-- 010: Sağlık verilerine stres seviyesi ekleme ve canlı ses oturumu desteği
ALTER TABLE health_samples DROP CONSTRAINT IF EXISTS health_samples_type_check;
ALTER TABLE health_samples ADD CONSTRAINT health_samples_type_check CHECK (type IN ('heart_rate', 'steps', 'stress'));

-- +Down
-- Geri alma durumunda stres kayıtları temizlenir ve eski kısıt geri yüklenir
DELETE FROM health_samples WHERE type = 'stress';
ALTER TABLE health_samples DROP CONSTRAINT IF EXISTS health_samples_type_check;
ALTER TABLE health_samples ADD CONSTRAINT health_samples_type_check CHECK (type IN ('heart_rate', 'steps'));
