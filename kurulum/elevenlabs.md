# ElevenLabs seslendirme

Videoların seslendirmesi **ElevenLabs** ile yapılır. Stüdyoya bir ya da birkaç ElevenLabs hesabının **API anahtarını** eklersin. Bir hesabın kredisi biterse, anahtarı çalışmazsa ya da seçili ses o hesapta yoksa seslendirme kendiliğinden sıradaki hesaba geçer. Bir videonun bütün sesi mümkünse aynı hesaptan çıkar.

- Başlamak için **Free** plan yeter (aylık ücretsiz kredi).
- Anahtar eklenmeden önce ElevenLabs'te denenir, yalnızca bu bilgisayarda saklanır ve stüdyoda bir daha gösterilmez.

## 1. Hesap aç

[elevenlabs.io](https://elevenlabs.io) adresinde ücretsiz hesap aç. Hesabın varsa bu adımı geç.

## 2. API anahtarı oluştur

1. ElevenLabs'te **Developers › API Keys** → **Create API Key**.
2. **Restrict Key** açıksa yalnızca şu üç izni aç; diğerleri **No Access** kalabilir:

   | İzin | Seviye | Stüdyoda ne için |
   | --- | --- | --- |
   | Text to Speech | Access | seslendirme üretmek |
   | Voices | Read | ses listesi ve örnek dinleme |
   | User | Read | kalan kredi göstergesi |

   Kısıtlama kapalıysa anahtar zaten her şeye erişir.
3. **Credit limit** boş kalabilir ya da aylık bir harcama sınırı yazabilirsin.
4. Oluşan anahtarı kopyala. Anahtar `sk_` ile başlar.

## 3. Stüdyoya ekle

1. Stüdyoda **Ayarlar › Seslendirme** → **ElevenLabs hesapları**.
2. İstersen **Hesap adı** yaz, anahtarı **API anahtarı (sk_…)** kutusuna kendin yapıştır → **Hesap ekle**.
3. Birden fazla hesabın varsa her biri için kendi anahtarını oluşturup ayrı ayrı ekle. **Önce hangisi kullanılsın?** seçeneğiyle "En çok kredisi olan" ya da "Listedeki sırayla" kullanımı seçebilirsin.

## 4. Anlatıcı sesini seç

**Ayarlar › Seslendirme › Ses** listesinden bir ses seç. Tüm videolarda aynı anlatıcı kullanılır.

- Ücretsiz planda API'de yalnızca hazır sesler çalışır; **Ücretsiz planda çalışanlar** sekmesinden seç.
- **Kütüphane sesleri** için Creator ve üstü bir planın anahtarı gerekir.
- **Model**, **Kararlılık** ve **Konuşma hızı** yeni seslendirmelerde geçerli olur; hazır videolar değişmez.

## Sorun çıkarsa

- **Anahtar eklenemedi**: Anahtarın tamamını kopyaladığından ve yukarıdaki üç iznin açık olduğundan emin ol.
- **"Seçili ses bu anahtarla çalışmaz"**: Hesabın ücretsiz planda; hazır seslerden birini seç.

## Claude ile kur

**Ayarlar › Seslendirme** içindeki **Claude ile kur** düğmesi, Claude'a gönderebileceğin hazır bir metin açar.

Güvenlik kuralları (metinde Claude'a da yazılıdır):

- ElevenLabs şifreni ve API anahtarını Claude'a yazma; anahtarı stüdyodaki kutuya kendin yapıştır.
- Anahtarı bir dosyaya kaydetme ya da bir komutla gönderme.
- Kayıt ve ödeme bilgilerini kendin gir; ücretli plana geçmen gerekmez.
- Bir hata görürsen Claude'a yalnızca hata metnini gönder.
