# Bulut yayın (Cloudflare)

Bilgisayarın kapalıyken de paylaşım yapılabilsin diye stüdyo, **kendi ücretsiz Cloudflare hesabına** küçük bir servis (Worker + KV deposu) kurar. Planladığın Reels videoları oraya yüklenir; saati gelince paylaşımı o servis yapar.

- Kurulumu stüdyo yapar; senden yalnızca bir **API anahtarı (token)** istenir.
- Süre: yaklaşık 5 dakika.
- Ücret: yok. Yalnızca Cloudflare'in ücretsiz planı kullanılır, kart eklemen gerekmez. Ücretsiz sınırlar (günde 100 000 istek, 1 000 yazma, 1 GB yer) aşılırsa yalnızca o işlem başarısız olur; stüdyo açıksa paylaşım bilgisayardan yapılır.
- Anahtar yalnızca bu bilgisayarda saklanır; istediğin zaman Cloudflare'den silebilirsin.

Cloudflare ekranları İngilizcedir; düğme adları aşağıda aynen yazıyor.

## 1. Ücretsiz hesap aç

[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) adresinden e-posta adresin ve bir şifreyle kaydol, e-postana gelen bağlantıyla hesabını doğrula. Plan sorulursa **Free** seç. Hesabın varsa bu adımı geç.

## 2. API anahtarı oluştur

1. [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) sayfasını aç.
2. Sağ üstteki **Create Token** düğmesine bas.
3. Şablon listesinde **Edit Cloudflare Workers** satırını bul ve **Use template**'e bas.
4. **Account Resources**: **Include** → kendi hesabın. **Zone Resources**: **Include** → **All zones** (sitesi olmayan hesaplarda da böyle kalır).
5. İsteğe bağlı: günlük kullanım sayılarını görmek için **Permissions** altında **+ Add more** → **Account** → **Account Analytics** → **Read** satırını ekle.
6. En altta **Continue to summary**, sonra **Create Token**.
7. Çıkan anahtarın yanındaki **Copy** ile kopyala. Cloudflare bu anahtarı bir daha göstermez; kaybedersen aynı adımlarla yenisini oluşturabilirsin.

Bu anahtarın stüdyoda kullanılan izinleri:

| İzin | Ne için |
| --- | --- |
| `Workers Scripts · Edit` | paylaşım servisini hesabına kurmak ve güncellemek |
| `Workers KV Storage · Edit` | videoları ve planları servisin deposunda saklamak |
| `Account Settings · Read` | hesabını bulmak |
| `Account Analytics · Read` | isteğe bağlı: günlük kullanım sayılarını göstermek |

Şablondaki diğer izinler kullanılmaz.

## 3. Stüdyoya bağla

1. Stüdyoda **Ayarlar › Bulut yayın** → **Bağla**.
2. Açılan pencerede anahtarı **Cloudflare API anahtarı** kutusuna kendin yapıştır → **Bağla**.
3. Stüdyo servisi hesabına kurar; her adımı pencerede görürsün. Anahtar birden fazla hesaba erişebiliyorsa kurulumun yapılacağı hesabı seçmen istenir.
4. Adımların hepsi yeşil tikle bitince kurulum tamam. Pencereyi kapatsan da kurulum arka planda sürer.

## Sorun çıkarsa

- **Kurulum tamamlanamadı**: Pencerede görünen hata metnini (anahtar olmadan) Claude'a gönder. Genelde anahtarın şablonu ya da hesap seçimi yanlıştır; 2. adımı tekrarla.
- **Stüdyo buluta ulaşamıyor**: İnternet bağlantını kontrol et. Sorun bu bilgisayardaysa servis Cloudflare'de çalışmaya devam eder ve planlı paylaşımlar yine saatinde yapılır.
- **Instagram anahtarı bulutta yok**: Önce Instagram'ı Ayarlar'dan bağla; anahtar buluta kendiliğinden gönderilir.

## Claude ile kur

**Ayarlar › Bulut yayın**, bulut ekranı ve bağlantı penceresindeki **Claude ile kur** düğmesi, Claude'a gönderebileceğin hazır bir metin açar.

Güvenlik kuralları (metinde Claude'a da yazılıdır):

- Cloudflare şifreni ve API anahtarını Claude'a yazma; anahtarı stüdyodaki kutuya kendin yapıştır.
- Anahtarı bir dosyaya kaydetme ya da bir komutla gönderme.
- Kayıt formunu, şart kabulünü ve onay düğmelerini kendin doldur ve bas.
- Ücretsiz planı seç; kart ekleme.
