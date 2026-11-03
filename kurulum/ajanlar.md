# Claude ajanları

Sosyal Stüdyo videoları kendisi üretmez. İşleri **Claude Code** oturumları, yani **ajanlar** yapar. Her ajan stüdyo klasöründeki `AJAN_TALIMAT.md` dosyasını okur, stüdyonun iş kuyruğunu bekler, gelen işi (yeni video, revizyon, fikir, açıklama, araştırma) bitirir ve yeniden beklemeye geçer.

## Gerekenler

- **Claude masaüstü uygulaması** ve Claude Code kullanabilen bir Claude hesabı.
- Stüdyonun açık olması. Ajan, stüdyonun kendi klasöründe çalışır.

## 1. Ajan oturumu aç

1. Claude masaüstü uygulamasında **Code** sekmesine geç.
2. Yeni bir oturum başlat ve klasör olarak **stüdyo klasörünü** seç (Claude ile kur penceresinde yolu görebilir ve kopyalayabilirsin).
3. Ajan uzun süre kendi başına komut çalıştırır. Stüdyonun Claude panelindeki adımlar, oturumu hangi izin moduyla açacağını anlatır.

## 2. Ajan metnini gönder

1. Stüdyonun üst çubuğundaki **Claude** göstergesine tıkla. Claude kullanımı paneli açılır.
2. Hesap kartının üstündeki **Bu hesaba ajan ekle** düğmesine bas.
3. **Video ajanı metnini kopyala** → metni yeni oturuma yapıştırıp gönder. Ajanın adı metinde yazar (ör. "Sosyal Ajan 1").
4. Ajan bağlanınca kartındaki ajan sayısı artar ve **Yapay Zeka** sekmesinde görünür.

## Ajan ne yapar? (AJAN_TALIMAT.md › Döngü)

0. Döngüye başlarken ve her işten sonra kendi oturum bilgisini (model, çaba) `studio.py usage-report` ile stüdyoya bildirir.
1. Şu komutu **arka planda** çalıştırır ve iş bekler:

   ```
   python -X utf8 studio.py wait --agent "Sosyal Ajan 1"
   ```

2. Komutun çıktısındaki **tek** işi talimattaki adımlarla bitirir.
3. `wait` komutunu yeniden başlatır. Döngüyü kendiliğinden bırakmaz.

## İsteğe bağlı roller

- **Fikir ajanı** ("Sosyal Fikir Ajanı"): Video yapmaz, yalnızca fikir ve açıklama yazar ki fikirler video kuyruğunu beklemesin. Panelde **Fikir ajanı metnini kopyala** ile ayrı bir oturumda açılır; `wait` komutunu `--only ideas,caption` ile çalıştırır.
- **Yönetici** (adı "Yönetici" olan oturum): İş almaz; Claude kullanım limitini stüdyoya bildirir ve panelde seçtiğin modeli ve çabayı ajanlara uygular. `python -X utf8 studio.py manage-wait --agent "Yönetici"` ile çalışır.
- **Aynı anda daha çok video**: Aynı hesaba ikinci bir video ajanı ekleyebilir ya da panelde **Yeni oturum ekle** ile başka bir Claude hesabı için ayrı bir uygulama açabilirsin. Ek hesaptaki ajanlar `wait` ve `usage-report` komutlarına `--account <id>` ekler; panelden kopyaladığın metin bunu zaten içerir.

## Limitler

Her video ajanı aynı anda bir video üretir; ElevenLabs kredisi ve Claude limiti de buna göre daha hızlı harcanır. Paneldeki kartlara tıklayarak hangi hesapların ajanlarının iş alacağını seçebilirsin; kapalı hesapların ajanları boşta bekler ve limit harcamaz.

## Claude ile kur

Claude panelindeki ve **Ayarlar › Bileşenler**'deki **Claude ile kur** düğmesi, Claude'a gönderebileceğin hazır bir metin açar. Elle yardım istersen Code sekmesinde stüdyo klasöründe açtığın bir oturuma yapıştır; Claude rehberi okuyup adımları seninle birlikte yapar.

Güvenlik kuralları (metinde Claude'a da yazılıdır):

- Şifreni, API anahtarlarını ya da token'ları Claude'a yazma; onları stüdyodaki kutulara kendin yapıştır.
- Gizli bilgileri bir dosyaya kaydetme ya da bir komutla gönderme.
- Onay, şart kabulü ve gönder düğmelerine kendin bas.
