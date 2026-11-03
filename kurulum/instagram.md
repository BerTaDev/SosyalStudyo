# Instagram bağlantısı

Sosyal Stüdyo; Reels, fotoğraf, kaydırmalı gönderi ve hikâye paylaşmak, yorumları ve mesajları yönetmek, istatistikleri göstermek için Instagram API'sini kullanır. Bunun için kendi Meta geliştirici uygulamanla **süresi dolmayan bir erişim anahtarı** (system user access token) oluşturup stüdyoya kendin yapıştırırsın.

- Süre: yaklaşık 20-30 dakika, bir kez yapılır.
- Ücret: yok.
- Anahtar yalnızca bu bilgisayarda (veri klasöründeki `settings.json`) saklanır.

## Gerekenler

- **Profesyonel** (İşletme ya da İçerik üreticisi) bir Instagram hesabı.
- Bir Facebook hesabı ve bu Instagram hesabının bağlı olduğu bir **Facebook sayfası**.
- Stüdyoda **Ayarlar › Instagram** bölümü.

## 1. Instagram hesabını profesyonel yap

Telefonda Instagram → **Ayarlar ve hareketler** → **Hesap türü ve araçlar** → **Profesyonel hesaba geç** → İşletme ya da İçerik üreticisi.

## 2. Hesabı işletme portföyüne ekle

1. [business.facebook.com/settings](https://business.facebook.com/settings) adresini aç. Portföyün yoksa ekrandaki adımlarla oluştur.
2. **Hesaplar › Instagram hesapları** → **Ekle** → Instagram hesabınla giriş yap. Meta doğrulama isteyebilir.
3. Instagram hesabının bağlı olduğu Facebook sayfası da **Hesaplar › Sayfalar** altında görünmeli.

## 3. Meta uygulaması oluştur

1. [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app**.
2. Uygulama türü olarak **Business** seç ve 2. adımdaki işletme portföyünü bağla.
3. Uygulama panelinde **Instagram** ürününü ekle ve **API setup with Facebook login** yolunu seç.

## 4. Anahtar yapılandırması oluştur

**Facebook Login for Business › Configurations** → **Create configuration**:

| Alan | Seçim |
| --- | --- |
| Access token type | **System-user access token** |
| Token expiration | **Never** |
| Permissions | aşağıdaki beş izin |

| İzin | Stüdyoda ne için |
| --- | --- |
| `instagram_basic` | profil, paylaşımlar, hesap bilgisi |
| `instagram_content_publish` | Reels, fotoğraf, kaydırmalı ve hikâye paylaşmak |
| `instagram_manage_comments` | yorumları okumak, yanıtlamak, gizlemek, silmek; etiketlenmeler |
| `instagram_manage_messages` | DM okumak ve yanıtlamak |
| `instagram_manage_insights` | görüntülenme, erişim, izlenme süresi istatistikleri |

## 5. Sistem kullanıcısıyla anahtar oluştur

1. [business.facebook.com/settings](https://business.facebook.com/settings) → **Kullanıcılar › Sistem kullanıcıları** → yönetici (Admin) bir sistem kullanıcısı ekle ya da var olanı seç.
2. **Varlık ata**: 3. adımdaki uygulamayı, Instagram hesabını ve bağlı Facebook sayfasını bu sistem kullanıcısına ata.
3. **Anahtar oluştur (Generate new token)** → uygulamayı seç → 4. adımdaki yapılandırmayı seç → oluştur.
4. Çıkan anahtarı Meta'nın kopyala düğmesiyle kopyala. Anahtar boşluksuz tek satırdır ve genelde `EAA` ile başlar.

## 6. Stüdyoya bağla

1. Stüdyoda **Ayarlar › Instagram** → **Erişim anahtarı (access token)** kutusuna anahtarı yapıştır.
2. **Bağlan**'a bas. Stüdyo anahtarı dener, hesabını bulur ve izin tablosunda her iznin durumunu gösterir.

Bu anahtarın süresi dolmaz. Stüdyo, Instagram girişiyle alınan ve `IGAA` ile başlayan anahtarları da kabul eder ve onların süresini kendisi yeniler.

## Mesajlar (DM) için ayrıca

Telefonda Instagram → **Ayarlar ve hareketler** → **Mesajlar ve hikâye yanıtları** → **Mesaj kontrolleri** → **Bağlı araçlar** → **Mesajlara erişime izin ver**.

## Sorun çıkarsa

- **"Yapıştırılan metin bir erişim anahtarına benzemiyor"**: Anahtarın tamamını Meta'daki kopyala düğmesiyle tekrar kopyala; başında ya da sonunda boşluk kalmasın.
- **"Bu anahtarla bağlı bir Instagram işletme hesabı bulunamadı"**: Instagram hesabı ve bağlı Facebook sayfası sistem kullanıcısına varlık olarak atanmış olmalı (5. adım).
- **İzin tablosunda eksik izin**: İzni 4. adımdaki yapılandırmaya ekle, sonra 5. adımdaki gibi yeni anahtar oluşturup stüdyoya tekrar yapıştır.

## Claude ile kur

Stüdyoda bu bölümün yanındaki **Claude ile kur** düğmesi, Claude'a gönderebileceğin hazır bir metin açar. Claude seni bu adımlarda tek tek yönlendirir.

Güvenlik kuralları (metinde Claude'a da yazılıdır):

- Şifreni, erişim anahtarını ya da başka bir gizli bilgiyi Claude'a yazma; anahtarı stüdyodaki kutuya kendin yapıştır.
- Anahtarı bir dosyaya kaydetme ya da bir komutla gönderme.
- Ad, adres gibi kişisel bilgileri ve doğrulama belgelerini Meta'ya kendin gir; onay, şart kabulü ve gönder düğmelerine kendin bas.
- Bir hata görürsen Claude'a yalnızca hata metnini, anahtar olmadan gönder.
