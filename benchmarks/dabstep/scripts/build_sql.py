"""Turn the DABstep context files into one SQL file for D1.

Tables keep the original file and column names so the manual's terminology
maps straight onto them. List-valued fields (in fees.json and
merchant_data.json) are stored as JSON text; query them with json_each().
Booleans are 0/1. The two markdown docs go into a `documents` table.

    python3 scripts/build_sql.py > data/load.sql
"""

import csv
import json
import sys
from pathlib import Path

CTX = Path(__file__).resolve().parent.parent / "data" / "context"
BATCH = 400


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def inserts(table, cols, rows):
    for i in range(0, len(rows), BATCH):
        values = ",\n".join("(" + ",".join(lit(r[c]) for c in cols) + ")" for r in rows[i : i + BATCH])
        print(f"INSERT INTO {table} ({','.join(cols)}) VALUES\n{values};")


def main():
    out = sys.stdout
    for t in ["payments", "fees", "merchant_data", "merchant_category_codes", "acquirer_countries", "documents"]:
        out.write(f"DROP TABLE IF EXISTS {t};\n")

    # payments.csv
    out.write("""CREATE TABLE payments (
  psp_reference INTEGER PRIMARY KEY, merchant TEXT, card_scheme TEXT, year INTEGER,
  hour_of_day INTEGER, minute_of_hour INTEGER, day_of_year INTEGER, is_credit INTEGER,
  eur_amount REAL, ip_country TEXT, issuing_country TEXT, device_type TEXT, ip_address TEXT,
  email_address TEXT, card_number TEXT, shopper_interaction TEXT, card_bin INTEGER,
  has_fraudulent_dispute INTEGER, is_refused_by_adyen INTEGER, aci TEXT, acquirer_country TEXT
);\n""")
    ints = {"psp_reference", "year", "hour_of_day", "minute_of_hour", "day_of_year", "card_bin"}
    bools = {"is_credit", "has_fraudulent_dispute", "is_refused_by_adyen"}
    rows = []
    with open(CTX / "payments.csv", newline="") as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames
        for r in reader:
            for c in cols:
                v = r[c]
                if v == "":
                    r[c] = None
                elif c in ints:
                    r[c] = int(v)
                elif c in bools:
                    r[c] = v == "True"
                elif c == "eur_amount":
                    r[c] = float(v)
            rows.append(r)
    inserts("payments", cols, rows)
    for c in ["merchant", "year, day_of_year", "card_scheme", "aci"]:
        out.write(f"CREATE INDEX payments_{c.replace(', ', '_')} ON payments ({c});\n")

    # fees.json
    out.write("""CREATE TABLE fees (
  ID INTEGER PRIMARY KEY, card_scheme TEXT, account_type TEXT, capture_delay TEXT,
  monthly_fraud_level TEXT, monthly_volume TEXT, merchant_category_code TEXT, is_credit INTEGER,
  aci TEXT, fixed_amount REAL, rate INTEGER, intracountry REAL
);\n""")
    fees = json.load(open(CTX / "fees.json"))
    for fee in fees:
        for k in ["account_type", "merchant_category_code", "aci"]:
            fee[k] = json.dumps(fee[k])
    inserts("fees", list(fees[0].keys()), fees)

    # merchant_data.json
    out.write("""CREATE TABLE merchant_data (
  merchant TEXT PRIMARY KEY, capture_delay TEXT, acquirer TEXT, merchant_category_code INTEGER, account_type TEXT
);\n""")
    merchants = json.load(open(CTX / "merchant_data.json"))
    for m in merchants:
        m["acquirer"] = json.dumps(m["acquirer"])
    inserts("merchant_data", ["merchant", "capture_delay", "acquirer", "merchant_category_code", "account_type"], merchants)

    # small CSVs (drop the pandas index column)
    for name, cols, ddl in [
        ("merchant_category_codes", ["mcc", "description"], "mcc INTEGER PRIMARY KEY, description TEXT"),
        ("acquirer_countries", ["acquirer", "country_code"], "acquirer TEXT PRIMARY KEY, country_code TEXT"),
    ]:
        out.write(f"CREATE TABLE {name} ({ddl});\n")
        with open(CTX / f"{name}.csv", newline="") as f:
            rows = [{c: (int(r[c]) if c == "mcc" else r[c]) for c in cols} for r in csv.DictReader(f)]
        inserts(name, cols, rows)

    out.write("CREATE TABLE documents (name TEXT PRIMARY KEY, content TEXT);\n")
    docs = [{"name": n, "content": (CTX / n).read_text()} for n in ["manual.md", "payments-readme.md"]]
    inserts("documents", ["name", "content"], docs)


if __name__ == "__main__":
    main()
