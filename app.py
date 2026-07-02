"""Flask app for the Nepal Grocery POS."""

from flask import Flask

from db import init_db

app = Flask(__name__)

init_db()


@app.route("/")
def index():
    return "Nepal Grocery POS"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
