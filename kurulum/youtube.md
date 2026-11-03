# YouTube Shorts

Planladığın Reels videoları aynı saatte YouTube kanalında **Shorts** olarak da yayınlansın. Stüdyo videoyu yayın saatinden önce (varsayılan 7 gün) YouTube'a yükler ve YouTube'un kendi zamanlayıcısıyla planlar; saati gelince YouTube kendisi yayınlar.

Bunun için kendi Google hesabında ücretsiz bir **Google Cloud projesi** açıp **YouTube Data API v3**'ü etkinleştirir ve **Desktop app** türünde bir OAuth istemcisi oluşturursun. Stüdyo bu istemcinin **Client ID** ve **Client secret** değerleriyle kanalına bağlanır.

- Süre: yaklaşık 10 dakika, bir kez yapılır.
- Ücret: yok, kart istemez.
- Bilgiler yalnızca bu bilgisayarda (`settings.json`) saklanır.

Google Cloud ekranları İngilizcedir; düğme adları aşağıda aynen yazıyor.

## 1. Proje oluştur

[console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate) → **Project name** alanına bir ad yaz (ör. Sosyal Stüdyo) → **Create**. Projeyi hangi Google hesabıyla açtığın önemli değil; kanal hesabını en son bağlanırken seçersin.

## 2. YouTube API'yi aç

[YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) sayfasında üstte yeni projenin seçili olduğunu kontrol et → **Enable**.

## 3. İzin ekranını kur

[Google Auth Platform](https://console.cloud.google.com/auth/overview) → **Get started**:

1. **App name**: bir ad (ör. Sosyal Stüdyo), **User support email**: e-postan → **Next**
2. **Audience**: **External** → **Next**
3. **Contact information**: e-postan → **Next**
4. Kutuyu işaretle → **Continue** → **Create**

## 4. Kanal hesabını test kullanıcısı yap

[Audience](https://console.cloud.google.com/auth/audience) sayfasında **Test users** → **Add users** → YouTube kanalının bağlı olduğu Google hesabının e-postası → **Save**.

> Proje **Testing** durumundayken Google bağlantıyı 7 günde bir koparır; stüdyo o zaman "Yeniden bağlan" der. Kalıcı bağlantı için [Branding](https://console.cloud.google.com/auth/branding) sayfasında ana sayfa ve gizlilik politikası bağlantılarını doldurup **Audience** sayfasında **Publish app** ile **In production** yap.

## 5. İstemci (anahtar) oluştur

[Clients](https://console.cloud.google.com/auth/clients) → **Create client** → **Application type**: **Desktop app** → bir ad yaz → **Create**. Açılan pencerede **Client ID** ve **Client secret** görünür.

Client secret sonradan tam görünmeyebilir; kaybedersen istemcinin sayfasında **Add secret** ile yenisini oluştur.

## 6. Stüdyoya yapıştır ve bağlan

1. Stüdyoda **Ayarlar › YouTube** → **Client ID** ve **Client secret** kutularına kendin yapıştır → **Kaydet**.
2. **Google ile bağlan**'a bas. Yeni sekmede Google açılır:
   - YouTube kanalının bağlı olduğu Google hesabını seç.
   - **"Google hasn't verified this app"** uyarısı çıkar. Uygulama senin kendi projen olduğu için bu normaldir: **Advanced** → **Go to … (unsafe)**.
   - Birden fazla kanalın varsa paylaşım yapılacak kanalı seç, izin ekranında **Continue** de.
3. **"YouTube bağlandı"** yazısını görünce sekmeyi kapat; stüdyo kendiliğinden algılar.

## 7. İlk videoyu kontrol et

Bağlandıktan sonra **Planlanan Reels videolarını YouTube Shorts olarak da paylaş** seçeneğini önce tek bir videoyla dene. Yayın saatinden sonra videonun YouTube'da herkese açık olduğunu kontrol et.

Google, denetimden (audit) geçmemiş bazı projelerin API ile yüklediği videoları gizli tutabilir. Böyle olursa **Ayarlar › YouTube** içindeki denetim bölümü, [YouTube API Services denetim formu](https://support.google.com/youtube/contact/yt_api_form) için gerekenleri adım adım hazırlar.

## Claude ile kur

**Ayarlar › YouTube** ve **Hesaplarım › YouTube** ekranındaki **Claude ile kur** düğmesi, Claude'a gönderebileceğin hazır bir metin açar. Claude seni bu adımlarda tek tek yönlendirir.

Güvenlik kuralları (metinde Claude'a da yazılıdır):

- Google şifreni ve Client secret'ı Claude'a yazma; ikisini de stüdyodaki kutulara kendin yapıştır.
- Gizli bilgileri bir dosyaya kaydetme ya da bir komutla gönderme.
- İzin ekranlarında onayı, şart kabulünü ve gönder düğmelerini kendin bas; kişisel bilgileri kendin gir.
- Bir hata görürsen Claude'a yalnızca hata metnini gönder.
