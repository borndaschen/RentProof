from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def page_number(canvas, document) -> None:  # type: ignore[no-untyped-def]
    canvas.saveState()
    canvas.setFont("RentProofCJK", 9)
    canvas.setFillColor(HexColor("#5F665F"))
    canvas.drawCentredString(A4[0] / 2, 13 * mm, f"第 {document.page} 頁（完全虛構 Demo）")
    canvas.restoreState()


def build(output: Path) -> None:
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite sealed fixture input: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    font_path = Path("C:/Windows/Fonts/msjh.ttc")
    if not font_path.is_file():
        raise FileNotFoundError("Microsoft JhengHei font is required for the synthetic PDF")
    pdfmetrics.registerFont(TTFont("RentProofCJK", str(font_path), subfontIndex=0))

    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "BodyCJK",
        parent=styles["BodyText"],
        fontName="RentProofCJK",
        fontSize=11,
        leading=19,
        textColor=HexColor("#202622"),
        spaceAfter=5 * mm,
    )
    title = ParagraphStyle(
        "TitleCJK",
        parent=body,
        fontSize=20,
        leading=28,
        alignment=TA_CENTER,
        textColor=HexColor("#163E31"),
        spaceAfter=8 * mm,
    )
    heading = ParagraphStyle(
        "HeadingCJK",
        parent=body,
        fontSize=14,
        leading=22,
        textColor=HexColor("#163E31"),
        spaceBefore=3 * mm,
        spaceAfter=3 * mm,
    )
    notice = ParagraphStyle(
        "NoticeCJK",
        parent=body,
        fontSize=10,
        leading=16,
        textColor=HexColor("#8A3B26"),
        backColor=HexColor("#FFF2E8"),
        borderPadding=8,
    )

    document = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title="晴光套房 302 - 完全虛構住宅租賃契約",
        author="RentProof synthetic fixture",
        subject="Synthetic data only",
    )

    story = [
        Paragraph("住宅租賃契約書（完全虛構 Demo）", title),
        Paragraph(
            "本文件僅供 RentProof 開發與展示。地址、人物、帳號與條款均為虛構，不得用於真實簽約或法律判斷。",
            notice,
        ),
        Spacer(1, 6 * mm),
        Paragraph("第一條　租賃標的", heading),
        Paragraph(
            "租賃標的名稱：晴光套房 302。所在地僅標示為「示範市和平區」，不對應真實門牌。租賃範圍為獨立套房、衛浴及陽台使用區。",
            body,
        ),
        Paragraph("第二條　租賃期間", heading),
        Paragraph("租期自 2026 年 10 月 1 日起至 2027 年 9 月 30 日止，共十二個月。", body),
        Paragraph("第三條　租金及相關費用", heading),
        Paragraph(
            "每月租金為新臺幣 12,000 元。管理費每月 1,000 元；網路費包含於租金；停車位未提供。除實際用電外，未約定其他一次性費用。",
            body,
        ),
        Paragraph("第四條　電費", heading),
        Paragraph(
            "承租人按獨立電表度數負擔電費，每度以新臺幣 6 元計收。出租人於承租人詢問時提供當期計算資訊。",
            body,
        ),
        PageBreak(),
        Paragraph("第五條　押金", heading),
        Paragraph("押金為兩個月租金，共新臺幣 24,000 元。返還條件另依點交結果由雙方確認。", body),
        Paragraph("第六條　修繕與通知", heading),
        Paragraph(
            "設備自然耗損之修繕由雙方依實際狀況確認。牆面、天花板或設備如有異常，承租人應先以可定位照片通知出租人；本條不預先判定原因或責任。",
            body,
        ),
        Paragraph("第七條　租金補貼", heading),
        Paragraph("承租人不得申請任何租金補貼；如有申請，出租人得終止本契約。", body),
        Paragraph("第八條　其他", heading),
        Paragraph(
            "本契約未排除廣告內容，但廣告所載設備仍應以附件一的設備清單與交屋點交紀錄為確認依據。",
            body,
        ),
        Paragraph("附件一　設備與交付狀態", heading),
    ]

    rows = [
        ["設備", "數量", "交付狀態"],
        ["冷氣", "1", "可啟動，交屋時再確認"],
        ["冰箱", "1", "可啟動，交屋時再確認"],
        ["床架與床墊", "1 組", "外觀如看屋照片"],
        ["書桌與座椅", "1 組", "外觀如看屋照片"],
    ]
    table = Table(rows, colWidths=[48 * mm, 28 * mm, 78 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), "RentProofCJK"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BACKGROUND", (0, 0), (-1, 0), HexColor("#DCEAE2")),
                ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#163E31")),
                ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#9DA89F")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            table,
            Spacer(1, 6 * mm),
            Paragraph(
                "注意：附件一未列洗衣機。這只表示契約附件尚未留下該項設備證據，不代表現場一定沒有洗衣機。",
                notice,
            ),
            Spacer(1, 10 * mm),
            Paragraph("出租人代稱：虛構出租人甲（未簽署）", body),
            Paragraph("承租人代稱：虛構承租人乙（未簽署）", body),
        ]
    )

    document.build(story, onFirstPage=page_number, onLaterPages=page_number)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.output.resolve())


if __name__ == "__main__":
    main()
