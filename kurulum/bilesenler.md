# Eksik bileşenler

Stüdyonun bazı işleri bilgisayarda ek bileşenler ister. **Ayarlar › Bileşenler** içindeki **Kurulum durumu** listesi her birinin durumunu gösterir; eksik olanların yanında **İndir**, **Kur** ya da **Claude ile kur** düğmesi bulunur.

| Bileşen | Ne için | Nasıl kurulur |
| --- | --- | --- |
| Video motoru | videoları çizmek ve dışa aktarmak | Python paketleri (numpy, scipy, soundfile, Pillow) ve Node.js |
| ffmpeg ve ffprobe | ses ve video işleme | listede **İndir** |
| Tarayıcı | videolar görünmez bir pencerede çizilir | Microsoft Edge (Windows'ta hazır gelir) ya da Google Chrome |
| TikTok yükleme (isteğe bağlı) | TikTok Studio'ya yükleme | listede **Kur** (Playwright paketi) |
| Konuşma tanıma (isteğe bağlı) | hazır ses ya da videodan altyazı ve kurgu | listede **İndir** (yaklaşık 1,6 GB model) |
| Claude Code | video ajanları | [Claude ajanları](ajanlar.md) rehberi |

## 1. Eksikleri gör

Stüdyoda **Ayarlar › Bileşenler**'i aç. Yeşil olanlar hazırdır; sarı ya da kırmızı olanların yanında ne eksik olduğu yazar.

## 2. Düğmesi olanları kur

- **ffmpeg ve ffprobe**: **İndir**'e bas. Stüdyo hazır Windows sürümünü (BtbN FFmpeg-Builds) indirir ve kendi araç klasörüne çıkarır.
- **TikTok yükleme**: **Kur**'a bas. Stüdyo Playwright paketini kurar.
- **Konuşma tanıma**: **İndir**'e bas. Bileşen kurulur ve model indirilir. Aynı işi **Oluştur › Hazır ses / video › İndir** ile de başlatabilirsin.

İndirme sürerken **Durdur** ile vazgeçebilirsin.

## 3. Elle kurulanlar

- **Eksik Python paketleri**: Listede yazan komutu komut isteminde çalıştır, ör.

  ```
  python -m pip install numpy scipy soundfile pillow
  ```

- **Node.js**: [nodejs.org](https://nodejs.org) adresinden **LTS** sürümünü kur ya da komut isteminde:

  ```
  winget install OpenJS.NodeJS.LTS
  ```

- **Tarayıcı**: Microsoft Edge ya da Google Chrome kurulu olmalı.

## 4. Kontrol et

Stüdyoyu yeniden başlat ve **Ayarlar › Bileşenler** listesinin yeşil olduğunu kontrol et.

## Claude ile kur

Listedeki **Claude ile kur** düğmesi, Claude'a gönderebileceğin hazır bir metin açar. Komut çalıştırmak gereken işlerde en kolayı: Claude masaüstü uygulamasında **Code** sekmesini aç, klasör olarak stüdyo klasörünü seç ve metni yapıştır. Claude her komutu çalıştırmadan önce ne yapacağını söyler ve senin onayını bekler.

Güvenlik kuralları (metinde Claude'a da yazılıdır):

- Şifreni, API anahtarlarını ya da token'ları Claude'a yazma.
- Yalnızca resmi kaynaklardan ve ücretsiz sürümlerden kur.
- Şart kabulü ve onay düğmelerine kendin bas.
- Bir hata görürsen Claude'a yalnızca hata metnini gönder.
